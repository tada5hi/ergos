# Project Structure

npm workspaces monorepo (`packages/*`), orchestrated by nx.

## Directory Layout

```
hubwire/
├── packages/
│   ├── hubwire/                         # package `hubwire` (core)
│   │   ├── src/
│   │   │   ├── index.ts                 # Public entry point; everything exported here is public API
│   │   │   ├── types.ts                 # ObjectLiteral
│   │   │   ├── hook/                    # invokeHook (guarded hook call), HookArgs
│   │   │   ├── component/               # IComponent, ICallable, IScheduledComponent, Component, defineScheduledComponent
│   │   │   ├── dispatcher/              # IDispatcher + LocalDispatcher / RemoteDispatcher, internal wire codec
│   │   │   ├── worker/                  # RemoteWorker, internal lifecycle helper
│   │   │   └── message-bus/             # IMessageBus, MessageBus, IMessageBusDriver, MemoryMessageBusDriver, message helpers
│   │   ├── test/
│   │   │   ├── unit/*.spec.ts           # One spec per module
│   │   │   ├── unit/fakes/              # TestComponent (FakeMessageBus, drain() come from @hubwire/test)
│   │   │   └── vitest.config.ts         # aliases `hubwire` and `@hubwire/test` to source
│   │   ├── package.json                 # nx.implicitDependencies: ["!@hubwire/test"] (cuts the inferred cycle)
│   │   ├── README.md, LICENSE
│   │   ├── tsconfig.json                # src + test (paths-mapped), used by `typecheck`
│   │   ├── tsconfig.build.json          # src only, resolved through node_modules; used by `build:types`
│   │   └── tsdown.config.ts             # esm, dts, sourcemap
│   ├── amqp/                            # package `@hubwire/amqp`
│   │   ├── src/                         # AmqpMessageBusDriver, IAmqpClient, hook/event types
│   │   ├── test/
│   │   │   ├── unit/driver.spec.ts
│   │   │   ├── unit/fakes/amqp-client.ts  # FakeAmqpClient; .loopback() delivers publishes to consumers
│   │   │   ├── unit/fixtures/hub-wire.ts  # Wire tuples captured from hub's former driver
│   │   │   └── vitest.config.ts         # aliases `hubwire` and `@hubwire/test` to source (no build needed)
│   │   └── package.json, README.md, LICENSE, tsconfig*.json, tsdown.config.ts
│   └── test/                            # package `@hubwire/test` (published test kit)
│       ├── src/
│       │   ├── index.ts                 # Public entry point
│       │   ├── conformance/             # defineDriverConformance, ConformanceFramework, ConformanceDriverFactory
│       │   ├── fake-message-bus.ts      # FakeMessageBus (IMessageBus that records, never delivers)
│       │   └── drain.ts                 # drain(): one setImmediate
│       ├── test/
│       │   ├── unit/memory.spec.ts      # the suite against MemoryMessageBusDriver
│       │   └── vitest.config.ts         # aliases `hubwire` to ../hubwire/src
│       └── package.json, README.md, LICENSE, tsconfig*.json, tsdown.config.ts
├── .github/
│   ├── assets/                          # README graphics, referenced by absolute raw.githubusercontent URLs from the package READMEs (npm)
│   │   ├── logo.svg, logo-amqp.svg      # header logos (hubwire, @hubwire/amqp)
│   │   └── architecture.svg, component.svg, amqp-retry.svg  # diagrams; light/dark via prefers-color-scheme
│   ├── actions/install/action.yml       # setup-node + cache (node_modules, packages/*/node_modules) + npm ci
│   ├── actions/build/action.yml         # cache **/dist by SHA + npm run build
│   ├── workflows/main.yml               # CI: install -> build -> (lint, typecheck, test)
│   ├── workflows/release.yml            # release-please -> build -> publish via tada5hi/monoship
│   ├── ISSUE_TEMPLATE/
│   └── dependabot.yml
├── .husky/                              # Git hooks dir (core.hooksPath); no hooks are committed
├── .agents/                             # Agent guides (this directory)
├── AGENTS.md, CLAUDE.md, README.MD
├── package.json                         # private root: workspaces, nx run-many scripts, shared devDependencies
├── nx.json                              # build dependsOn ^build; cacheable build/lint/test/typecheck
├── tsconfig.build.json                  # shared compiler options (extends @tada5hi/tsconfig)
├── tsconfig.json                        # + paths: hubwire / @hubwire/amqp / @hubwire/test -> packages/*/src
├── eslint.config.js                     # flat config wrapping @tada5hi/eslint-config
├── commitlint.config.mjs
├── release-please-config.json           # monorepo mode, node-workspace plugin
└── .release-please-manifest.json        # one version per package path
```

## Module Responsibilities

| Module | Purpose |
|---|---|
| `hubwire/src/component/types.ts` | `IComponent` (`start` / `stop` / `status`, optional `handle` and `settled`), `ICallable` (`handle` required), `IScheduledComponent` (`settled` required) |
| `hubwire/src/component/module.ts` | `Component`: key → handler map, `'*'` fallback, per-handler memoized `initialize()`, child events via `context.handle`, unhandled → `options.handle`, status of top-level calls |
| `hubwire/src/component/scheduled.ts` | `defineScheduledComponent`: cron expression validated at definition (croner, 5 or 6 fields), first pass on start, then its own timer loop over croner's `nextRun()` (waits at most 30 s per timer, re-evaluates a slot croner answers in the past) that passes each tick's planned slot as `scheduledAt`, no overlap (a tick during a pass joins it), a failed pass → `hooks.onError`; `stop()` never waits for a pass (a pass may stop its own component), stop-during-start never schedules, the timer is cleared; returns an `IScheduledComponent` whose `settled()` resolves once no pass runs (a shutdown awaits it after `stop()`; a pass must never await its own) |
| `hubwire/src/dispatcher/` | `IDispatcher` → `{ correlationId }`. `LocalDispatcher` (in-process, returns forwarded events as `replies`, optional `reply` component, no lifecycle), `RemoteDispatcher` (publishes a command; a rejected publish rejects `dispatch()`; no hooks) |
| `hubwire/src/dispatcher/wire.ts` | Internal (not exported): `correlate`, `toMessage` (drops a caller's `delivery`, a legacy body `attempt` and `timestamp`, overwrites `routing` in place), `fromMessage` (the only wire cast), `toForwardedMessage` (also drops `persistent` and `expiresAt`). Used by the dispatchers and `RemoteWorker` |
| `hubwire/src/worker/` | `RemoteWorker`: consumes a routing into an `ICallable`, publishes forwarded events (replies and unhandled commands) to `publish`, else `onUnrouted`; a rejected publish fails the command. Itself an `IComponent` on the internal `worker/lifecycle.ts` (`createLifecycle(acquire)`: a `start()` joins one in flight, a `stop()` waits for it and releases, calls during a release queue in call order so the last one wins, a failed `start()` or release can be retried) |
| `hubwire/src/message-bus/` | `IMessageBus` + `MessageBus` (type dispatch with `'*'` fallback; `onPublish` / `onConsume` / `onUnhandled` / `onExpired` / `onError` hooks; an expired `metadata.expiresAt` is acked without a handler; `close()` → driver), `IMessageBusDriver` / `IMessageBusConsumer` (the delivery contract: `publish()` resolves `void` on hand-off, never waits for or sees a handler; `close()` required; `metadata.delivery` on consume), `MemoryMessageBusDriver` (delivers on a microtask, swallows handler errors; WORK (per namespace and key) = a queue that keeps messages until consumed, round-robin, `ordered` → first consumer, one handler at a time; a PUB_SUB `queue` = such a queue per name (from its first consume; `publish()` ignores `queue`), one copy each; any other PUB_SUB fan-out and drop; `cancel()` awaits in-flight handlers; `consume()` / `publish()` reject after `close()`; `delivery` 1/1), `buildMessage` / `isMessage` / `serializeMessage` / `assertMessageRouting` (a WORK namespace with `/` → `TypeError`; both drivers call it) |
| `hubwire/src/hook/` | `invokeHook(hooks, name, ...args)`: calls a hook with `hooks` as `this` and ignores a throw or a rejected promise |
| `amqp/src/` | `AmqpMessageBusDriver`: routing → exchange/queue options, publish properties (`persistent`: `metadata.persistent` ?? `routing.persistent` ?? WORK; `expiresAt` → `expiration`), decode + guard (`onMalformed`), `metadata.delivery` (WORK and a PUB_SUB `queue`: `x-attempt` + `maxAttempts`; plain PUB_SUB: 1/1), a PUB_SUB `queue` → amqp-extension's consume `queue` (durable, shared, retried; the publisher declares no queue); every WORK → the default exchange, queue `key` (`namespace/key` with a namespace; publisher and consumer both declare it), retry/drop reporting (`onRetry` / `onDrop`); retry and the redelivery guard are amqp-extension's |
| `test/src/conformance/` | `defineDriverConformance({ describe, it }, createDriver)`: the driver contract as cases on `node:assert`, one fresh driver per case (closed by the case), a `conformance-<uuid>` key each. Imports no test framework: callers pass vitest's, jest's or node:test's `describe` / `it` |
| `test/src/fake-message-bus.ts`, `test/src/drain.ts` | `FakeMessageBus` (records publishes and consumes, never delivers; injectable errors and a consume gate) and `drain()`, shared by hubwire's specs and consumers' |

## Hooks

Every observable event is an optional, typed hook on the class's `hooks` option; the hook
types sit in the module's `types.ts` (`MessageBusHooks`,
`RemoteWorkerHooks`, `ScheduledComponentHooks`, `AmqpMessageBusDriverHooks`). Call them only
through `invokeHook`: hooks observe and must never change an outcome — every hook site can sit
on a consume path, where a propagated error would turn an ack into a retry.

## Key Dependencies

- `hubwire`: `croner` (scheduled components: evaluates the cron expression, also in a timezone; hubwire owns the timer loop), its only runtime dependency. It never imports amqp-extension.
- `@hubwire/amqp`: `amqp-extension` (`^5.1.1`, dependency) and `hubwire` (peer + dev, workspace version; release-please's node-workspace plugin bumps the range); `@hubwire/test` (dev).
- `@hubwire/test`: `hubwire` (peer + dev), no runtime dependency; its version starts at `0.0.0`, so its first release is `0.1.0` (release-please component `test`).
- `hubwire` does **not** list `@hubwire/test`: that would be an nx cycle (`@hubwire/test` → `hubwire`). Its specs reach it through the vitest alias and the root `tsconfig.json` paths, and `nx.implicitDependencies: ["!@hubwire/test"]` in its `package.json` cuts the edge nx would infer from those imports.

## Package Exports

Every package publishes only `dist/` (plus README/LICENSE) with a single `.` export:

```json
{
    "main": "dist/index.mjs",
    "types": "dist/index.d.mts",
    "exports": {
        "./package.json": "./package.json",
        ".": { "types": "./dist/index.d.mts", "import": "./dist/index.mjs" }
    },
    "files": ["dist"]
}
```

- **ESM-only.** No CJS output; `"type": "module"`.
- `src/index.ts` is each package's single public surface: a symbol not exported there is internal.
- After changing an `exports` map, verify by hand: `npm run build`, then
  `node --input-type=module -e "await import('./packages/<pkg>/dist/index.mjs')"` and
  `npm pack --dry-run -w packages/<pkg>`.

## Separation of Concerns

- **Library code** → `packages/<pkg>/src/`
- **Tests** → `packages/<pkg>/test/unit/` (the spec `describe` names the source path, e.g. `describe('src/dispatcher/remote', ...)`)
- **Build / bundling** → `packages/<pkg>/tsdown.config.ts`; orchestration → `nx.json`
- **Lint / style / commit rules** → shared `@tada5hi/*` configs, thinly wrapped by the root config files
- **CI, release, dependency updates** → `.github/`
