# Dispatchers and Remote Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `DirectCaller` / `DispatchCaller` / `WorkerCaller` / `ICaller` with `IDispatcher`, `LocalDispatcher`, `RemoteDispatcher` and `RemoteWorker` on a shared internal lifecycle helper and wire codec (issue #12, closes #9).

**Architecture:** Two dispatchers implement one `IDispatcher` contract; `RemoteWorker` consumes a routing into a component and publishes its forwarded events. An internal `createLifecycle` helper owns start/stop races for `RemoteWorker` and `defineScheduledComponent`; an internal wire module owns casts, correlation and forwarded-metadata cleaning.

**Tech Stack:** TypeScript (ESM, `moduleResolution: bundler`), Vitest, node-cron, npm workspaces + nx.

**Spec:** `docs/superpowers/specs/2026-10-16-dispatcher-worker-design.md`

## Global Constraints

- `MessageMetadata.attempt` (from #11) is set by a retrying driver on consume: `RemoteWorker` passes it to the component, forwarded events never carry it.
- Only `packages/synergos` changes; `@synergos/amqp` and `packages/amqp/test/unit/fixtures/hub-wire.ts` stay untouched and green.
- `node-cron` remains `synergos`' only runtime dependency.
- Contracts (`I*`), option and hook types live in the module's `types.ts`; hooks are called only through `invokeHook`; a hook never changes an outcome.
- Internal helpers (`createLifecycle`, the wire module) are **not** re-exported from `src/index.ts`.
- Tests: fakes, never `vi.fn()` / `vi.mock()`; import from `'../../src'`; outer `describe` names the source path; `it('should …')`.
- No `as any`; the only casts sit in the wire module (`fromMessage`).
- 4-space indent, single quotes, semicolons, no `.js` extensions on relative imports.
- After each task: `npm run build && npm run typecheck && npm run lint && npm run test` from the repo root, all green.
- Commits: Conventional Commits, no AI attribution trailer.

## Review Focus

1. `stop()` while `start()` is blocked in `component.start()` → no consumer survives (Task 4 test).
2. `start()` twice concurrently → exactly one consumer (Task 4 test).
3. `start()` after `stop()` → consumes again (Task 4 test; Task 1 test for scheduled).
4. A `start()` whose acquire fails (e.g. `consumeAny` rejects) → rejects, leaves the component stopped, and a later `start()` works (Task 4 test).
5. `RemoteDispatcher` keeps a caller-given `persistent` on the command but a forwarded event never inherits the command's `persistent` / `attempt` / `timestamp` / `routing` (Task 3 + Task 4 tests).

---

### Task 1: Lifecycle helper, scheduled component on top of it

**Files:**
- Create: `packages/synergos/src/component/lifecycle.ts` (not added to `component/index.ts`)
- Modify: `packages/synergos/src/component/scheduled.ts`
- Test: `packages/synergos/test/unit/scheduled.spec.ts`

**Interfaces:**
- Produces: `createLifecycle(acquire: () => Promise<() => Promise<void>>): { start(): Promise<void>, stop(): Promise<void> }`
  - `acquire` returns its `release`.
  - `start()`: if a start is in flight or done, join / return it; else run `acquire`. A rejecting `acquire` rejects `start()` and resets, so the next `start()` acquires again.
  - `stop()`: take the current state (if none, resolve); await the in-flight acquire (ignore its rejection); run its `release`. A `start()` after `stop()` acquires again.

- [ ] **Step 1: Adjust and add tests in `scheduled.spec.ts`**
  - `should not schedule when stopped during the first pass`: `stop()` now waits for the first pass, so reorder to `const stopped = c.stop(); firstPass.resolve(); await Promise.all([started, stopped]);` then the existing `wait(1500)` / `expect(passes).toBe(1)`.
  - New `should start again after stop`: `runOnStart: true`, `schedule: '0 0 1 1 *'`, count passes; `start` → `stop` → `start` → `expect(passes).toBe(2)`; `stop`.
- [ ] **Step 2: Run** `cd packages/synergos && npx vitest --config test/vitest.config.ts --run test/unit/scheduled.spec.ts` — the reordered case passes already, the restart case is expected to pass too; record the result (this pins behaviour before the refactor).
- [ ] **Step 3: Implement `createLifecycle`** in `lifecycle.ts`; rewrite `defineScheduledComponent` so `start`/`stop` come from `createLifecycle(async () => { if (runOnStart ?? true) await execute(); const task = cron.schedule(options.schedule, execute, { noOverlap: true }); return async () => { await task.stop(); }; })`. Remove `generation` and the `task` variable; keep `run` / `execute` / `pass` / status as they are. Drop the old `// ponytail:` note on stop (stop still does not wait for later ticks' passes — keep a one-line `ponytail:` comment saying so).
- [ ] **Step 4: Run** the scheduled spec, then the root gates. Expected: all PASS.
- [ ] **Step 5: Commit** `refactor: run scheduled components on a shared lifecycle helper`

### Task 2: Shared types, wire module, LocalDispatcher

**Files:**
- Modify: `packages/synergos/src/component/types.ts` (add `ICallable`, `ForwardedEvent`)
- Create: `packages/synergos/src/dispatcher/{types,local,wire,index}.ts` (`wire.ts` not exported from `dispatcher/index.ts`)
- Modify: `packages/synergos/src/index.ts` (`export * from './dispatcher'`)
- Test: `packages/synergos/test/unit/local-dispatcher.spec.ts`

**Interfaces:**
- Produces (in `component/types.ts`):
  - `interface ICallable<EM extends ComponentEventMap = ComponentEventMap> extends IComponent<EM> { handle: NonNullable<IComponent<EM>['handle']> }`
  - `type ForwardedEvent<EM extends ComponentEventMap = ComponentEventMap> = { [K in keyof EM & string]: { key: K, data: EM[K][0], metadata: EM[K][1] } }[keyof EM & string]`
- Produces (in `dispatcher/types.ts`):
  - `type DispatchResult = { correlationId: string, delivered: boolean }`
  - `interface IDispatcher<EM> { dispatch<K extends keyof EM & string>(key: K, data: EM[K][0], metadata?: EM[K][1]): Promise<DispatchResult> }`
  - `type LocalDispatcherOptions<EM> = { reply?: ICallable<EM> }`
  - `type LocalDispatchResult<EM> = DispatchResult & { replies: ForwardedEvent<EM>[] }`
- Produces (in `dispatcher/wire.ts`, internal):
  - `correlate<M extends ComponentMetadata>(metadata?: M): M & { correlationId: string }` — keeps a non-empty `correlationId`, else `crypto.randomUUID()`.
  - `toMessage(key: string, data: ObjectLiteral, metadata: ComponentMetadata, routing: MessageRouting): Message` — `buildMessage({ type: key, data, metadata: { ...metadata, routing } })`, no stripping (a dispatcher's caller may set `persistent`).
  - `toForwardedMessage(event: ForwardedEvent, routing: MessageRouting): Message` — removes `attempt`, `timestamp`, `persistent`, `routing` from `event.metadata`, then `toMessage`.
  - `fromMessage<EM>(message: Message): ForwardedEvent<EM>` — the single cast at the wire boundary.
- Produces: `class LocalDispatcher<EM> implements IDispatcher<EM>` with `constructor(component: ICallable<EM>, options?: LocalDispatcherOptions<EM>)` and `dispatch(...): Promise<LocalDispatchResult<EM>>`.

- [ ] **Step 1: Write `local-dispatcher.spec.ts`** (`describe('src/dispatcher/local', …)`, using `TestComponent`):
  - `should return the forwarded events in order`: `dispatch('execute', { id: 'a' })` → `replies` equals `[{ key: 'executionFinished', data: { id: 'a' }, metadata: expect.objectContaining({ correlationId: expect.any(String) }) }]`, `delivered: true`, `correlationId` equals the reply's `metadata.correlationId`.
  - `should forward an unknown command`: on `new Component()`, `dispatch('nope', {})` → `replies` = `[{ key: 'nope', data: {}, metadata: expect.objectContaining({ correlationId: expect.any(String) }) }]`.
  - `should keep a given correlationId`: `dispatch('execute', { id: 'a' }, { correlationId: 'given' })` → result and reply carry `'given'`.
  - `should keep duplicate forwarded events`: component handler emitting `executionFinished` twice → `replies` length 2.
  - `should hand forwarded events to the reply component`: inbox `Component` with `executionFinished` handler recording `(data, ctx.metadata.correlationId)` → recorded `[{ id: 'a' }, result.correlationId]`.
  - `should reject when a handler throws`: component handler throws `new Error('x')` → `rejects.toThrow('x')`; same for a throwing `reply` handler.
- [ ] **Step 2: Run** the spec → FAIL (`LocalDispatcher` not exported).
- [ ] **Step 3: Implement** types, `wire.ts`, `LocalDispatcher` (`component.handle(key, data, correlate(metadata), { handle: (childData, ctx) => { replies.push({ key: ctx.key, data: childData, metadata: ctx.metadata }); return reply?.handle(ctx.key, childData, ctx.metadata); } })`), barrels.
- [ ] **Step 4: Run** the spec and root gates → PASS.
- [ ] **Step 5: Commit** `feat: add IDispatcher and LocalDispatcher`

### Task 3: RemoteDispatcher

**Files:**
- Create: `packages/synergos/src/dispatcher/remote.ts`; modify `dispatcher/types.ts`, `dispatcher/index.ts`
- Test: `packages/synergos/test/unit/remote-dispatcher.spec.ts`

**Interfaces:**
- Consumes: `correlate`, `toMessage` (Task 2), `IMessageBus`.
- Produces: `type RemoteDispatcherHooks = { onUndelivered?(message: Message): void }`, `type RemoteDispatcherOptions = { messageBus: IMessageBus, routing: MessageRouting, hooks?: RemoteDispatcherHooks }`, `class RemoteDispatcher<EM> implements IDispatcher<EM>` with `constructor(options: RemoteDispatcherOptions)`.

- [ ] **Step 1: Write `remote-dispatcher.spec.ts`** (`describe('src/dispatcher/remote', …)`, `FakeMessageBus`):
  - `should publish the command to its routing`: one published message; `type: 'execute'`, `data: { id: 'a' }`, `metadata.routing` = routing, `Object.keys(metadata)[0] === 'timestamp'`, `metadata.correlationId` = result's.
  - `should keep a given correlationId and persistent`: metadata `{ correlationId: 'c', persistent: false }` → published metadata matches both.
  - `should report delivered from the bus`: `accepted = true` → `delivered: true`; `accepted = false` → `delivered: false`.
  - `should report an undelivered command to onUndelivered`: `accepted = false`, hook records the message → recorded = `bus.published[0]`.
  - `should resolve the same result when onUndelivered throws`: throwing hook → resolves `{ delivered: false, correlationId: any string }`.
  - `should reject when publish rejects`: a bus whose `publish` rejects (subclass `FakeMessageBus`) → `rejects`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `RemoteDispatcher`.
- [ ] **Step 4: Run** spec + root gates → PASS.
- [ ] **Step 5: Commit** `feat: add RemoteDispatcher, resolving whether the bus accepted the command`

### Task 4: RemoteWorker

**Files:**
- Create: `packages/synergos/src/worker/{types,module,index}.ts`; modify `src/index.ts`
- Modify: `packages/synergos/test/unit/fakes/message-bus.ts` (add `consumeGate?: Promise<void>` awaited at the start of `consume`, `consumeError?: unknown` that makes `consume` reject, and `active` = number of consumers not yet cancelled)
- Test: `packages/synergos/test/unit/remote-worker.spec.ts`

**Interfaces:**
- Consumes: `createLifecycle` (Task 1), `fromMessage`, `toForwardedMessage` (Task 2), `RemoteDispatcher` (Task 3, in tests).
- Produces: `type RemoteWorkerHooks<EM> = { onUnrouted?(event: ForwardedEvent<EM>): void, onUndelivered?(message: Message): void }`, `type RemoteWorkerOptions<EM> = { messageBus: IMessageBus, consume: MessageRouting, reply?: MessageRouting, hooks?: RemoteWorkerHooks<EM> }`, `class RemoteWorker<EM> implements IComponent<EM>` with `constructor(component: ICallable<EM>, options: RemoteWorkerOptions<EM>)`, `start()`, `stop()`, `status()`.
- Behaviour: acquire = `component.start()` → `consumeAny(consume, handler)`; if `consumeAny` rejects, `await component.stop()` and rethrow. release = `consumer.cancel()` → `component.stop()`. The handler passes `fromMessage(message)` to `component.handle` with a `handle` option that publishes `toForwardedMessage(event, reply)` (resolved `false` → `onUndelivered`), or without `reply` calls `onUnrouted(event)`. Inbound metadata passes through unchanged.

- [ ] **Step 1: Write `remote-worker.spec.ts`** (`describe('src/worker/module', …)`). Memory-driver cases use `new MessageBus({ driver: new MemoryMessageBusDriver() })`, `TestComponent`, `RemoteDispatcher`:
  - `should round-trip a command to an inbox with the same correlationId`: worker(commands→replies) + `RemoteWorker(inbox, { consume: replies })`; `const { correlationId } = await dispatcher.dispatch('execute', { id: 'a' })` → inbox recorded `[{ id: 'a' }, correlationId]`.
  - `should clean the forwarded metadata`: dispatch with `{ attempt: 5, persistent: true, correlationId: 'c' }`; the component's handler sees `ctx.metadata.attempt === 5` (inbound metadata passes through — this is how a driver-set delivery attempt from #11 reaches the handler); a raw `consumeAny(replies)` sees `metadata` with `correlationId: 'c'`, `routing: replies`, no `attempt`, no `persistent`, and `timestamp >= ` the time taken before dispatch.
  - `should forward an unknown command to reply`: dispatch `'nope'` → raw reply consumer sees `type: 'nope'`.
  - `should report a forwarded event with no reply routing to onUnrouted`: hook records → `[{ key: 'executionFinished', data: { id: 'a' }, metadata: objectContaining({ correlationId }) }]`; with a throwing `onUnrouted` the dispatch still resolves.
  - `should report an undelivered forwarded event and still settle the command`: `reply` set, nobody consumes it → `onUndelivered` records one message of type `executionFinished`; `dispatch` resolves `delivered: true`; with a throwing hook it still resolves.
  - `should stop only after the handler in flight finished`: port the existing `worker-caller.spec.ts` case (blocker, order, lifecycle `['start', 'stop']`, no consumption after stop).
  - `should start again after stop`: start → stop → start → dispatch handled; `component.lifecycle` = `['start', 'stop', 'start']`.
  - `should delegate status to the component`.
  - `FakeMessageBus` cases:
    - `should leave no consumer when stopped during start`: component whose `start` awaits a deferred; `const started = worker.start(); const stopped = worker.stop();` resolve the deferred; `await Promise.all([started, stopped])` → `bus.active === 0`.
    - `should register one consumer when started twice`: `await Promise.all([worker.start(), worker.start()])` → `bus.consumed.length === 1`.
    - `should stay stopped when consume fails, and start later`: `bus.consumeError = new Error('x')` → `start()` rejects, `component.lifecycle` = `['start', 'stop']`; clear the error → `start()` resolves, `bus.active === 1`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `RemoteWorker` and the fake changes.
- [ ] **Step 4: Run** spec + root gates → PASS.
- [ ] **Step 5: Commit** `feat: add RemoteWorker on the shared lifecycle helper`

### Task 5: Remove the callers, update docs

**Files:**
- Delete: `packages/synergos/src/caller/` and `test/unit/{direct,dispatch,worker}-caller.spec.ts`
- Modify: `packages/synergos/src/index.ts`, `component/types.ts` docs if they mention callers, `test/unit/component.spec.ts` (only if it imports caller symbols)
- Modify: `README.MD`, `packages/synergos/README.md`, `packages/amqp/README.md`, `AGENTS.md`, `.agents/structure.md`, `.agents/testing.md`, `.github/assets/architecture.svg` (text labels only: `DirectCaller` → `LocalDispatcher`, `DispatchCaller` → `RemoteDispatcher`, `WorkerCaller` → `RemoteWorker`; keep geometry, widen a box only if a label overflows)

- [ ] **Step 1: Delete** the caller sources and specs; remove `export * from './caller'`.
- [ ] **Step 2: Run** `grep -rn "Caller\|callAndWait\|consumeRouting\|publishRouting" packages/*/src packages/*/test README.MD packages/*/README.md AGENTS.md .agents .github/assets` → only hits to rewrite.
- [ ] **Step 3: Rewrite the docs** with the new API: the usage block from the spec (composition-root switch, worker + inbox, `LocalDispatcher(...).replies`, the #9 fallback), the hooks table (`RemoteDispatcher.onUndelivered`, `RemoteWorker.onUnrouted` / `onUndelivered`, `defineScheduledComponent.onError`), the export table, "forwarded events" (unhandled commands are forwarded on purpose), and that `LocalDispatcher` has no lifecycle. `.agents/structure.md`: module table rows for `dispatcher/`, `worker/`, the internal `component/lifecycle.ts` and `dispatcher/wire.ts`. `.agents/testing.md`: spec list.
- [ ] **Step 4: Run** the grep again → no hits; root gates → PASS; `npm run build` then `node --input-type=module -e "const m = await import('./packages/synergos/dist/index.mjs'); for (const k of ['LocalDispatcher','RemoteDispatcher','RemoteWorker','defineScheduledComponent']) if (!m[k]) throw k; for (const k of ['DirectCaller','createLifecycle','toMessage']) if (m[k]) throw k;"` → exits 0.
- [ ] **Step 5: Commit** `feat!: replace the callers with LocalDispatcher, RemoteDispatcher and RemoteWorker` with body `Closes #9, closes #12.` and footer `BREAKING CHANGE: DirectCaller, DispatchCaller, WorkerCaller, ICaller and their option/hook types are removed; see the README for the migration.`
