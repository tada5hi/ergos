# Dispatchers and the remote worker

Replaces `DirectCaller`, `DispatchCaller`, `WorkerCaller` and `ICaller` in `synergos` with
`IDispatcher` / `LocalDispatcher` / `RemoteDispatcher` and `RemoteWorker`, on one internal
lifecycle helper and one internal wire codec. Also resolves #9.

## Why

- **The command → reply round trip is split.** `DispatchCaller` puts the routing into the metadata
  and sets no `correlationId`. `WorkerCaller` casts the inbound message and strips reply metadata by
  hand (`delete attempt / timestamp / persistent`). Correlation exists only on `DirectCaller`.
- **The three callers share a one-method `ICaller` but differ only in where forwarded events go.**
  The "component can not be called" guard is duplicated, and `WorkerCaller` is both a caller and
  a component.
- **Lifecycle is reimplemented per class, and `WorkerCaller` gets it wrong.** A `stop()` while
  `start()` awaits `component.start()` finds no consumer; `start()` then registers one that feeds
  a stopped component. A second `start()` registers a second consumer.
- **#9:** a dispatcher can't tell whether the bus accepted the command, so hub can't fall back to
  running it in-process.

## Goals

- One dispatch contract, two implementations, interchangeable at the composition root.
- A local dispatch also hands the forwarded events straight back to the caller.
- Every dispatch carries a `correlationId`; forwarded events keep it.
- Every dispatch reports whether it was delivered (#9).
- Start / stop races are impossible in `RemoteWorker` and `defineScheduledComponent`.
- One place for the wire casts and for cleaning forwarded-event metadata.

## Non-goals

- Awaiting a reply over the bus by correlation id (request/response). Hub and authup correlate
  in their own inbox components.
- Changing `IMessageBusDriver`, the drivers' delivery semantics, or `@synergos/amqp`. That is the
  driver-contract issue, which also takes #10 (delivery attempt on the handler).
- Default routing names or any other hub/authup policy.
- A shared status tracker: `Component` and the scheduled component keep their own few lines.

## Anti-goals

- The hub-wire format changing beyond the additive `metadata.correlationId` on commands. The
  `hub-wire` fixture comparison in `@synergos/amqp` must pass untouched.
- A hook that changes an outcome (resolve vs. reject, ack vs. retry).

## Concepts

**Forwarded events.** Whatever a component does not handle goes to `ComponentHandleOptions.handle`:
the child events it emits through `context.handle` (its replies) *and* a top-level command no
handler and no `'*'` accepted. This is intentional, so a component can pass work on to the next
one; it stays exactly as `Component` implements it today. Both dispatchers and the worker treat
the two kinds the same.

## API

Exported from `synergos`:

```ts
/**
 * A component that can be called: an IComponent whose handle is not optional.
 * Component satisfies it.
 */
interface ICallable<EM extends ComponentEventMap = ComponentEventMap> extends IComponent<EM> {
    handle: NonNullable<IComponent<EM>['handle']>;
}

/** One forwarded event, typed by key. */
type ForwardedEvent<EM extends ComponentEventMap = ComponentEventMap> = {
    [K in keyof EM & string]: { key: K, data: EM[K][0], metadata: EM[K][1] }
}[keyof EM & string];

type DispatchResult = {
    correlationId: string,
    /** The bus accepted the command (RemoteDispatcher), always true for LocalDispatcher. */
    delivered: boolean,
};

interface IDispatcher<EM extends ComponentEventMap = ComponentEventMap> {
    dispatch<K extends keyof EM & string>(key: K, data: EM[K][0], metadata?: EM[K][1]): Promise<DispatchResult>;
}

class LocalDispatcher<EM> implements IDispatcher<EM> {
    constructor(component: ICallable<EM>, options?: { reply?: ICallable<EM> });
    dispatch<K>(key: K, data, metadata?): Promise<DispatchResult & { replies: ForwardedEvent<EM>[] }>;
}

class RemoteDispatcher<EM> implements IDispatcher<EM> {
    constructor(options: {
        messageBus: IMessageBus,
        routing: MessageRouting,
        hooks?: { onUndelivered?(message: Message): void },
    });
}

class RemoteWorker<EM> implements IComponent<EM> {
    constructor(component: ICallable<EM>, options: {
        messageBus: IMessageBus,
        consume: MessageRouting,
        /** Where forwarded events are published. Unset: they are dropped and reported. */
        reply?: MessageRouting,
        hooks?: {
            onUnrouted?(event: ForwardedEvent): void,
            onUndelivered?(message: Message): void,
        },
    });
}

defineScheduledComponent(options)   // API unchanged
```

Hook types live in the modules' `types.ts` as `RemoteDispatcherHooks` / `RemoteWorkerHooks`,
options as `LocalDispatcherOptions` / `RemoteDispatcherOptions` / `RemoteWorkerOptions`.

Removed: `ICaller`, `DirectCaller`, `DispatchCaller`, `WorkerCaller`, `CallerPayload`,
`DirectCallerResponse`, `DispatchCallerOptions`, `DispatchCallerHooks`, `WorkerCallerOptions`,
`WorkerCallerHooks`. Breaking; the package is pre-1.0.

### Usage

```ts
// composition root: one line decides where Builder runs
const inbox = new Component<EM>();
inbox.mount('buildFinished', (data, ctx) => done(ctx.metadata.correlationId, data));

const dispatcher: IDispatcher<EM> = bus
    ? new RemoteDispatcher({ messageBus: bus, routing: commands })
    : new LocalDispatcher(new Builder(), { reply: inbox });

// worker node
await new RemoteWorker(new Builder(), { messageBus: bus, consume: commands, reply: replies }).start();
await new RemoteWorker(inbox, { messageBus: bus, consume: replies }).start();

// tests / single node: forwarded events come straight back
const { replies } = await new LocalDispatcher(new Builder()).dispatch('build', { id: '1' });

// #9: fall back to in-process when the bus did not accept
const result = await remote.dispatch('build', data);
if (!result.delivered) await local.dispatch('build', data);
```

## Behaviour

### LocalDispatcher

- `correlationId` = `metadata.correlationId` if set, else `crypto.randomUUID()`; it is in the
  metadata the component sees and therefore in every forwarded event's metadata (Component merges
  parent metadata into child events).
- Calls `component.handle(key, data, metadata, { handle })`. The `handle` option appends each
  forwarded event to `replies` (in emission order, duplicates kept) and, if `reply` is set, awaits
  `reply.handle(event.key, event.data, event.metadata)`.
- A handler error (component or reply) rejects `dispatch`.
- Resolves `{ correlationId, delivered: true, replies }`.

### RemoteDispatcher

- Same `correlationId` rule.
- Publishes `toMessage(key, data, metadata, routing)` and resolves
  `{ correlationId, delivered: <publish() result> }`.
- `delivered === false` → `onUndelivered(message)` (through `invokeHook`); still resolves.
- A rejecting `publish()` rejects `dispatch`.

### RemoteWorker

- `start()`: `component.start()`, then `messageBus.consumeAny(consume, …)`. Each message is decoded
  by `fromMessage` and passed to `component.handle` with a `handle` option that publishes each
  forwarded event as `toMessage(event…, reply)`, or — no `reply` — reports it to `onUnrouted`
  and drops it.
- Publishing a forwarded event that resolves `false` (no consumer, memory driver) →
  `onUndelivered(message)`. The command still settles normally (acked): a retry would re-run the
  component's side effects for a reply-only problem.
- `stop()`: cancel the consumer (waits for the handler in flight), then `component.stop()`.
- `status()`: the component's.
- Lifecycle guarantees, from the shared helper:
  - a `start()` while one is in flight joins it — one consumer, ever, per running worker;
  - a `stop()` while `start()` is in flight waits for it, then releases — no consumer survives;
  - `start()` after `stop()` starts again;
  - a failed `start()` leaves nothing running and can be retried.

### Wire codec (internal)

- `toMessage(key, data, metadata, routing)`: removes `attempt`, `timestamp`, `persistent` and
  `routing` from the metadata, then `buildMessage({ type: key, data, metadata: { ...rest, routing } })`.
  `buildMessage` keeps `timestamp` first, so the body stays byte-compatible with hub's.
- `fromMessage(message)`: `{ key: message.type, data: message.data, metadata: message.metadata }`
  — the only cast at the wire boundary.

### Lifecycle helper (internal)

`lifecycle({ acquire, release })` → `{ start, stop }` implementing the guarantees above. Used by
`RemoteWorker` and `defineScheduledComponent`, whose `generation` counter it replaces.
`defineScheduledComponent` keeps every documented behaviour (first pass on start, `noOverlap`,
failed pass → `onError`, stop-during-start never schedules), with one change: `stop()` now waits
for a first pass in flight instead of returning before it settles.

## Tests

Replace, don't layer. Fakes, no `vi.fn()`.

- `local-dispatcher.spec.ts` (replaces `direct-caller.spec.ts`): forwarded events returned in
  order; unknown top-level command returned as a forwarded event; `correlationId` generated / kept
  and present on forwarded events; `reply` component receives them; handler error rejects;
  `delivered: true`.
- `remote-dispatcher.spec.ts` (replaces `dispatch-caller.spec.ts`): command shape (routing,
  timestamp first, `correlationId`); `delivered` mirrors `publish()`; `onUndelivered`, and a
  throwing hook leaves the result unchanged.
- `remote-worker.spec.ts` (replaces `worker-caller.spec.ts`): round trip over the memory driver —
  `RemoteDispatcher` → `RemoteWorker` → `RemoteWorker(inbox)` with the same `correlationId`;
  forwarded metadata lacks `attempt` / `persistent` / the command's routing and has a fresh
  timestamp; `onUnrouted` without `reply`, also with a throwing hook; `stop()` waits for the handler
  in flight; `onUndelivered` for a forwarded event nobody consumes, and the command still
  resolves; **stop during a blocked `component.start()` leaves zero consumers; double `start()`
  registers one consumer** (both fail against today's `WorkerCaller`).
- `scheduled.spec.ts`: keeps its cases.
- `@synergos/amqp` `driver.spec.ts` and the `hub-wire` fixture: untouched and green.

## Docs

`README.MD`, `packages/synergos/README.md`, `packages/amqp/README.md`, `AGENTS.md`,
`.agents/structure.md`, `.agents/testing.md` and the labels in `.github/assets/architecture.svg`
move to the new names.

## Calls made by the author (not discussed)

- Type name `ForwardedEvent` (was "Reply" in discussion), since it also carries unknown commands.
- `onUnrouted` takes one `ForwardedEvent` instead of `(key, data, metadata)`.
- `stop()` of a scheduled component waits for a first pass in flight.
- `LocalDispatcher` has no lifecycle (as `DirectCaller` today): the app starts / stops the
  component and the `reply` inbox it hands over. `Component.start()` is a no-op by default, so this
  rarely matters. Interchangeable means the *dispatch* side, not who owns lifecycles.
- Local forwarded events are not cleaned: no transport added `attempt` / `timestamp` /
  `persistent` / `routing`, so there is nothing to strip. The metadata the caller passed is kept.
- `RemoteWorker` passes an inbound command's metadata through unchanged; it does not invent a
  `correlationId` for a command that has none (nobody could match a fresh one).
- Source layout is the builder's: e.g. `src/dispatcher/`, `src/worker/`, with the lifecycle helper
  and wire codec not re-exported from `src/index.ts`.

## Left to the builder

File layout, internal helper names, test case wording, how the READMEs are restructured.
