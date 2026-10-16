<p align="center">
    <img src="https://raw.githubusercontent.com/tada5hi/synergos/master/.github/assets/logo.svg" alt="synergos" width="128" height="128" />
</p>

<h1 align="center">synergos</h1>

<p align="center">
    <b>Components with a lifecycle, scheduled jobs, and the message bus between them.</b><br>
    A <code>Component</code> maps command keys to handlers; dispatchers reach it in-process or over a bus,<br>
    and every observable event is a typed hook instead of a logger.
</p>

<p align="center">
    <a href="https://npmjs.com/package/synergos"><img src="https://badge.fury.io/js/synergos.svg" alt="npm version" /></a>
    <a href="https://github.com/tada5hi/synergos/actions/workflows/main.yml"><img src="https://github.com/tada5hi/synergos/actions/workflows/main.yml/badge.svg" alt="CI" /></a>
    <a href="https://codecov.io/gh/tada5hi/synergos"><img src="https://codecov.io/gh/tada5hi/synergos/branch/master/graph/badge.svg?token=4KNSG8L13V" alt="codecov" /></a>
    <a href="https://conventionalcommits.org"><img src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white" alt="Conventional Commits" /></a>
</p>

<p align="center">
    <a href="#installation"><b>Installation</b></a>
    ·
    <a href="#components">Components</a>
    ·
    <a href="#scheduled-components">Scheduled</a>
    ·
    <a href="#message-bus">Message Bus</a>
    ·
    <a href="#dispatchers-and-workers">Dispatchers</a>
    ·
    <a href="#hooks">Hooks</a>
    ·
    <a href="#api">API</a>
</p>

---

## Why synergos?

Queue workers, cron jobs and in-process services tend to grow separately: each has its own
startup and shutdown code, its own health flag and its own logger, and the handler logic ends up
written against the transport it first ran on. synergos separates the three concerns:

- **What a component does** is a set of handlers, `mount('build', (data, context) => …)`. A
  handler never sees a queue, a channel or an ack.
- **How it is reached** is a dispatcher. `LocalDispatcher` calls it in-process, `RemoteDispatcher`
  publishes a command, and a `RemoteWorker` consumes commands into it and publishes its replies.
- **Where messages travel** is a driver behind `MessageBus`. `MemoryMessageBusDriver` ships here,
  [`@synergos/amqp`](https://npmjs.com/package/@synergos/amqp) adds RabbitMQ.

Everything that runs in the background, components, workers and scheduled jobs, implements the
same `IComponent` contract (`start`, `stop`, `status`), so an application can start, stop and
health-check all of them in one loop.

**Table of Contents**
- [Installation](#installation)
- [Components](#components)
  - [Handlers and replies](#handlers-and-replies)
  - [Initialization](#initialization)
  - [Lifecycle and status](#lifecycle-and-status)
- [Scheduled components](#scheduled-components)
- [Message bus](#message-bus)
  - [Routing](#routing)
  - [Consuming](#consuming)
  - [Drivers](#drivers)
  - [Driver conformance](#driver-conformance)
- [Dispatchers and workers](#dispatchers-and-workers)
  - [Forwarded events](#forwarded-events)
  - [Publishing selected replies](#publishing-selected-replies)
  - [Testing a handler](#testing-a-handler)
- [Migrating from 0.1](#migrating-from-01)
- [Hooks](#hooks)
- [API](#api)
- [Notes](#notes)
- [License](#license)

## Installation

```bash
npm install synergos --save
```

The package is ESM-only and requires Node.js `>=22`. Its only runtime dependency is
[node-cron](https://www.npmjs.com/package/node-cron), for scheduled components.

## Components

### Handlers and replies

A `Component` maps command keys to handlers. The optional event map types each key's data and
metadata:

```typescript
import { Component } from 'synergos';
import type { ComponentMetadata } from 'synergos';

type BuilderEvents = {
    build: [{ id: string }, ComponentMetadata],
    buildFinished: [{ id: string }, ComponentMetadata],
    buildFailed: [{ id: string, reason: string }, ComponentMetadata],
};

class Builder extends Component<BuilderEvents> {
    constructor() {
        super();

        this.mount('build', async (data, context) => {
            try {
                // ... do the work ...
                await context.handle('buildFinished', data);
            } catch (e) {
                await context.handle('buildFailed', { id: data.id, reason: (e as Error).message });
            }
        });
    }
}
```

`context.handle(key, data)` emits a child event. It is resolved like any other key, in this order:

<p align="center">
    <img src="https://raw.githubusercontent.com/tada5hi/synergos/master/.github/assets/component.svg" alt="handle(key) runs the mounted handler, else the '*' fallback, else the caller's options.handle (a reply), else resolves without error" width="100%" />
</p>

So an event the component does not handle itself, `buildFinished` above, falls through to the
caller's `options.handle`. That is how replies leave a component: a `RemoteWorker` publishes them,
a `LocalDispatcher` collects them. The parent's metadata (such as a `correlationId`) is merged into
every child event.

`mount('*', handler)` catches every key without its own handler, and `unmount(key)` removes one.

### Initialization

A handler can be an object with an `initialize()` that runs before its first call, for example to
open a connection lazily:

```typescript
builder.mount('build', {
    initialize: () => registry.connect(),
    handle: async (data, context) => { /* ... */ },
});
```

`initialize()` runs once per handler, also for a handler mounted later. A failed `initialize()` is
forgotten, so the next call retries it. `component.initialize()` runs them all up front.

### Lifecycle and status

Every component implements `IComponent`:

```typescript
interface IComponent {
    start(): Promise<void>;
    stop(): Promise<void>;
    status(): ComponentStatus; // { lastSuccessAt?: number, runningSince?: number }
    handle?(key, data, metadata?, options?): Promise<void>;
}
```

`status()` reports top-level calls only (child events do not count): `runningSince` is set while
a call is in flight, `lastSuccessAt` when the last one completed without throwing. `start()` and
`stop()` do nothing on a plain `Component`. Override them to acquire and release background work.

## Scheduled components

`defineScheduledComponent` turns a function into a background job:

```typescript
import { defineScheduledComponent } from 'synergos';

const cleaner = defineScheduledComponent({
    schedule: '*/5 * * * *', // node-cron: every five minutes
    run: () => sessions.deleteExpired(new Date()),
    hooks: {
        onError: (error) => logger.warn('session cleanup failed', error),
    },
});

await cleaner.start(); // one pass now, then one per tick
cleaner.status();      // { lastSuccessAt, runningSince }
await cleaner.stop();
await cleaner.settled(); // the pass in flight, if any, has finished
```

- `start()` runs a first pass before scheduling. Pass `runOnStart: false` to wait for the first tick.
- Passes never overlap: a tick while a pass is still running is skipped.
- A failing pass goes to `hooks.onError` and never rejects. The next tick simply runs again.
- `stop()` never waits for a pass in flight, so a pass may stop its own component. Stopped during
  the first pass, the component never schedules a tick. A pass must not *await* its component's
  `start()`, which would join the pass itself: restart with `void cleaner.start()`.
- A shutdown that must outlive the pass (e.g. before closing the database) awaits `settled()`
  after `stop()`; it resolves at once when no pass is running. A pass must never await its own
  component's `settled()`: it would wait for itself and deadlock.
- An invalid cron expression throws when the component is defined, before any pass runs.

## Message bus

`MessageBus` dispatches messages by `type` to handlers and hands publishing and consuming to a
driver. Dispatchers and workers depend on the `IMessageBus` contract, not the class.

```typescript
import { MemoryMessageBusDriver, MessageBus, buildMessage } from 'synergos';

const messageBus = new MessageBus({ driver: new MemoryMessageBusDriver() });

await messageBus.consume({ type: 'pubSub', key: 'user' }, {
    userCreated: (message) => mailer.welcome(message.data),
});

await messageBus.publish(buildMessage({
    type: 'userCreated',
    data: { id: '1', email: 'jane@example.com' },
    metadata: { routing: { type: 'pubSub', key: 'user' } },
}));
```

A message is `{ id, type, data, metadata: { timestamp, routing, persistent?, expiresAt?, delivery? } }`. `buildMessage()`
fills in the `id` and `timestamp`, `isMessage()` checks the shape, and `serializeMessage()` writes
JSON that keeps `Error`s as `{ name, message, code? }`.

`expiresAt` (epoch ms) makes a message expire: one consumed after it is settled (acked) without
running a handler and reported to `onExpired`, also when it was retried or requeued. Pass it per
dispatch, e.g. `dispatcher.dispatch('check', data, { expiresAt: Date.now() + 60_000 })`.

### Routing

| Field | Purpose |
|---|---|
| `type` | `'work'`: each message goes to one consumer (round-robin); with a `namespace`, to every consumer. `'pubSub'`: each message goes to every consumer |
| `key` | The queue (work) or routing key (pubSub) |
| `namespace` | Optional. Separates routings with the same key, e.g. an exchange name in the amqp driver |
| `ordered` | `work` only: one consumer and one handler at a time, in publish order, with failover to another replica |
| `queue` | `pubSub` consume only: a durable subscription. Consumers naming the same queue share its messages (each once, retried like `work`); each queue name gets its own copy. Publishers omit it |

### Consuming

`consume(routing, handlers)` picks the handler for the message's `type`, or `'*'` for every other
type. A message that no handler accepts is settled (acked) without error and reported to
`onUnhandled`. `consumeAny(routing, handler)` is `consume()` with a single `'*'` handler. Both
resolve to a consumer whose `cancel()` resolves once the handlers in flight have settled.

Every driver sets `metadata.delivery = { attempt, maxAttempts }` on the message it hands a
handler. `attempt` is 1-based, `maxAttempts` is how often the driver tries before it drops the
message (`1` when it does not retry). A handler can tell its last attempt apart, e.g. to report a
failure instead of throwing once more:

```typescript
const { attempt, maxAttempts } = message.metadata.delivery ?? { attempt: 1, maxAttempts: 1 };
if (attempt < maxAttempts && isTransient(error)) throw error; // let the driver retry
```

`delivery` is never published: dispatchers and workers strip it before a message goes out.

### Drivers

| Driver | Package | Use it for |
|---|---|---|
| `MemoryMessageBusDriver` | `synergos` | Tests and single-process apps. No retries: a failed handler's message is dropped (`delivery` is `1/1`) |
| `AmqpMessageBusDriver` | [`@synergos/amqp`](https://npmjs.com/package/@synergos/amqp) | RabbitMQ: persistent work queues, retries with backoff, topic exchanges for pubSub |

A driver implements `IMessageBusDriver`: `publish(routing, message)`, `consume(routing, handler)`
and `close()`. Every driver keeps the same contract:

- `publish()` resolves once the transport took the message (amqp: broker confirm, memory:
  enqueued). It never waits for a handler, and a handler's error never reaches it. It rejects
  only when the hand-off fails, e.g. after `close()`.
- A `work` message without `namespace` reaches one consumer (an `ordered` one: one handler at a
  time); a namespaced `work` or a `pubSub` message reaches every consumer, except that the
  consumers naming the same `queue` share one copy. `publish()` ignores `queue`.
- `cancel()` resolves once the consumer's handlers in flight settled; `close()` makes later
  publishes and consumes reject. `MessageBus.close()` closes its driver.

The memory driver keeps amqp's queue semantics: a `work` routing without `namespace` is a queue
that keeps a message until a consumer takes it, and so is a `pubSub` `queue` once a consumer
declared it (round-robin across its consumers); any other routing gives each consumer its own copy
and drops a message nobody consumes (amqp: an exclusive queue per consumer).

### Driver conformance

`synergos/conformance` pins that contract as test cases. Hand it your test framework's `describe` /
`it` and a driver factory; it asserts with `node:assert`, so it works with vitest, jest or
`node:test`:

```typescript
import { describe, it } from 'vitest';
import { defineDriverConformance } from 'synergos/conformance';

defineDriverConformance({ describe, it }, () => new MyMessageBusDriver());
```

Each case gets a fresh driver and closes it. `MemoryMessageBusDriver` and `AmqpMessageBusDriver`
run the same suite.

## Dispatchers and workers

<p align="center">
    <img src="https://raw.githubusercontent.com/tada5hi/synergos/master/.github/assets/architecture.svg" alt="A RemoteDispatcher publishes a build command through the message bus to a RemoteWorker, whose component replies with buildFinished" width="100%" />
</p>

Both dispatchers implement `IDispatcher`: `dispatch(key, data, metadata?)` resolves
`{ correlationId }`. The `correlationId` is `metadata.correlationId`, or a fresh UUID
when the metadata has none, and every forwarded event carries it.

| Class | Where the component runs | Forwarded events |
|---|---|---|
| `LocalDispatcher` | In this process | Returned as `replies`, and handed to the `reply` component if one is set |
| `RemoteDispatcher` | Wherever a `RemoteWorker` consumes its `routing` | Published by that worker to its `publish` routing |
| `RemoteWorker` | Wraps the component and consumes the `consume` routing into it | Published to `publish`; without one, dropped and reported to `onUnrouted` |

The examples use the `Builder` component from [Components](#components) and these two routings:

```typescript
const commands = { type: 'work', key: 'builder' } as const;
const events = { type: 'work', key: 'builder-events' } as const;
```

### In-process

A `LocalDispatcher` runs the component right away and returns what it forwarded:

```typescript
import { LocalDispatcher } from 'synergos';

const { replies } = await new LocalDispatcher(new Builder()).dispatch('build', { id: '1' });
replies; // [{ key: 'buildFinished', data: { id: '1' }, metadata: { correlationId: '…' } }]
```

### Over a message bus

On the worker side, a `RemoteWorker` consumes `commands` and publishes the forwarded events to
`events`. On the dispatching side, a second `RemoteWorker` consumes `events` into an inbox
component, and a `RemoteDispatcher` sends the commands:

```typescript
import { Component, RemoteDispatcher, RemoteWorker } from 'synergos';

// worker side
await new RemoteWorker(new Builder(), { messageBus, consume: commands, publish: events }).start();

// dispatching side
const inbox = new Component<BuilderEvents>();
inbox.mount('buildFinished', (data, context) => {
    console.log('finished', data.id, context.metadata.correlationId);
});
await new RemoteWorker(inbox, { messageBus, consume: events }).start();

const dispatcher = new RemoteDispatcher<BuilderEvents>({ messageBus, routing: commands });
await dispatcher.dispatch('build', { id: '1' });
```

Pass the event map (`RemoteDispatcher<BuilderEvents>`), or annotate the variable as
`IDispatcher<BuilderEvents>`: without it, any key and any data compile.

### Choosing at startup

Both dispatchers implement `IDispatcher`, so the rest of the application does not care where the
component runs. Give a `LocalDispatcher` the same inbox as `reply`, and the replies arrive the same
way in both modes:

```typescript
import type { IDispatcher } from 'synergos';

const dispatcher: IDispatcher<BuilderEvents> = messageBus
    ? new RemoteDispatcher({ messageBus, routing: commands })
    : new LocalDispatcher(new Builder(), { reply: inbox });
```

### Lifecycle

A `RemoteWorker` is itself an `IComponent`: start and stop it with the rest of your application.
`start()` starts the component, then consumes; `stop()` cancels the consumer, waits for the handler
in flight, then stops the component. A concurrent `start()` joins the one in flight, a `stop()`
during `start()` leaves no consumer behind, and a failed `start()` can be retried. A handler, or the
component's own `start()` / `stop()`, must not *await* the worker's `stop()`: the stop waits for
them. Call `void worker.stop()` instead; the worker ends stopped once they return.

A `LocalDispatcher` has no lifecycle: start and stop the component, and the `reply` inbox you hand
it, yourself.

### Forwarded events

A forwarded event is whatever a component does not handle itself and passes to `options.handle`:
the child events it emits through `context.handle` (its replies), *and* a top-level command that no
handler and no `'*'` accepted. The latter is on purpose, so a component can pass work on to the
next one. Dispatchers and workers treat both kinds the same.

A `RemoteWorker` passes an inbound command's metadata to the component unchanged, including the
driver's `delivery`. The events it publishes keep the rest of the metadata (such as the
`correlationId`) but drop the command's `delivery`, `timestamp`, `persistent`, `expiresAt` and `routing`.
Likewise, a `RemoteDispatcher` never sends a caller's `delivery`, `timestamp` or `routing`, so
dispatching with an inbound `context.metadata` (to keep the `correlationId`) starts a fresh command;
only a `persistent` or `expiresAt` the caller passes is kept. A `LocalDispatcher` hands the metadata to the
component as given.

A forwarded event whose publish *rejects* fails the command like a throwing handler: over AMQP the
command is retried. An inbox handler's error stays with the inbox's own consumer; it never reaches
the worker or `dispatch()`.

### Publishing selected replies

To run a component in-process but still announce some of its replies on the bus, dispatch locally
and publish the chosen `replies` through a `RemoteDispatcher` on the events routing. Passing each
reply's metadata keeps its `correlationId`:

```typescript
const local = new LocalDispatcher(new Builder());
const announce = new RemoteDispatcher<BuilderEvents>({ messageBus, routing: events });

const { replies } = await local.dispatch('build', { id: '1' });
for (const reply of replies) {
    if (reply.key === 'buildFinished') {
        await announce.dispatch(reply.key, reply.data, reply.metadata);
    }
}
```

Unlike a `RemoteWorker`, a `RemoteDispatcher` keeps a `persistent` flag or `expiresAt` present in that metadata.

### Testing a handler

No fake context is needed: mount the handler on a `Component`, dispatch through a
`LocalDispatcher` with the metadata the case needs, and assert on the replies:

```typescript
const component = new Component<BuilderEvents>();
component.mount('build', buildHandler);

// e.g. the last delivery attempt of a retrying driver
const { replies } = await new LocalDispatcher(component)
    .dispatch('build', { id: '1' }, { delivery: { attempt: 5, maxAttempts: 5 } });

const failed = replies.find((reply) => reply.key === 'buildFailed');
```

`replies.find((reply) => reply.key === …)` narrows `reply.data` to that event's type.

## Migrating from 0.1

0.2 replaces the callers with dispatchers and a worker:

| 0.1 | 0.2 |
|---|---|
| `ICaller.call(key, data, metadata)` | `IDispatcher.dispatch(key, data, metadata?)`, resolves `{ correlationId }` |
| `DirectCaller.call(key, data, metadata)` | `LocalDispatcher.dispatch(key, data, metadata?)` |
| `DirectCaller.callAndWait(...)` → `{ [key]: data }` | `LocalDispatcher.dispatch(...).replies`, an array in emission order: `replies.find((r) => r.key === 'buildFinished')` |
| `DirectCaller.callWith(key, data, metadata, { handle })` | `component.handle(key, data, metadata, { handle })`, or the `reply` option of `LocalDispatcher` |
| `new DispatchCaller({ routing, messageBus, hooks })` | `new RemoteDispatcher({ routing, messageBus })` |
| `DispatchCallerOptions`, `DispatchCallerHooks` | `RemoteDispatcherOptions` (no hooks) |
| `new WorkerCaller(component, { consumeRouting, publishRouting, messageBus, hooks })` | `new RemoteWorker(component, { consume, publish, messageBus, hooks })` |
| `WorkerCallerOptions`, `WorkerCallerHooks` | `RemoteWorkerOptions`, `RemoteWorkerHooks` |
| `WorkerCaller.call(...)` | `LocalDispatcher`; a `RemoteWorker` is no longer a caller |
| `CallerPayload`, `DirectCallerResponse` | `ForwardedEvent`, `LocalDispatchResult` |
| an `IComponent` passed to a caller | an `ICallable` (an `IComponent` whose `handle` is not optional); `Component` is one |

Behaviour that changed:

- **`onUnrouted` takes one event.** `onUnrouted(key, data, metadata)` is now
  `onUnrouted({ key, data, metadata })`. A one-parameter hook written against 0.1, such as
  `onUnrouted(key)`, still compiles but then receives the event object.
- **One delivery contract for every driver.** `publish()` resolves `void` once the transport took
  the message; `MemoryMessageBusDriver` no longer awaits the handlers, never rejects with their
  error and keeps a `work` message until a consumer takes it. Tests that relied on `publish()` (or
  `dispatch()`) resolving after the handlers must wait for them. `IMessageBusDriver.close()` is
  required, and `IMessageBus` has `close()`.
- **`metadata.delivery` replaces `metadata.attempt`.** Every driver sets
  `{ attempt, maxAttempts }` on consume, so a handler no longer assumes the driver's default
  `maxAttempts`.
- **Every command carries a `correlationId`.** `RemoteDispatcher` generates one when the metadata has
  none; 0.1's `DispatchCaller` sent none.
- **Commands drop a caller's `delivery`, `timestamp` and a legacy body `attempt`.** Re-dispatching with an inbound
  `context.metadata` no longer carries the delivery attempt over; pass it explicitly if a receiver
  needs it.
- **Worker lifecycle races are handled.** `RemoteWorker` joins a concurrent `start()`, and a `stop()`
  during `start()` leaves no consumer behind, so application-side ordering of starts and teardown
  is no longer needed for that.
- **Scheduled components** validate the cron expression when they are defined and destroy their
  node-cron task on `stop()`.

## Hooks

There is no logger option. Each class takes an optional `hooks` object of typed observers. Wire them
to your logger, metrics or tracing:

| Options of | Hook | When |
|---|---|---|
| `MessageBus` | `onPublish(message)` | Before a message is handed to the driver |
| | `onConsume(message, routing)` | A message arrived, before dispatch |
| | `onUnhandled(message, routing)` | No handler (and no `'*'`) accepted it. It is acked |
| | `onExpired(message, routing)` | Its `metadata.expiresAt` had passed. It is acked without a handler |
| | `onError(error, message, routing)` | A handler threw. The error is rethrown to the driver afterwards |
| `RemoteWorker` | `onUnrouted(event)` | A forwarded event was dropped because no `publish` routing is set |
| `defineScheduledComponent` | `onError(error)` | A pass failed |

```typescript
const messageBus = new MessageBus({
    driver,
    hooks: {
        onError: (error, message, routing) => logger.error(`${message.type} in ${routing.key} failed`, error),
        onUnhandled: (message, routing) => logger.debug(`no handler for ${message.type} in ${routing.key}`),
    },
});
```

Hooks only observe. A hook that throws, or returns a promise that rejects, is ignored: it can never
turn an ack into a retry or reject a `publish()`. Your own extensions can follow the same rule with
`invokeHook(hooks, 'onSomething', ...args)`.

## API

| Export | Kind | Purpose |
|---|---|---|
| `Component` | class | `mount()`, `unmount()`, `handle()`, `initialize()`, `start()`, `stop()`, `status()` |
| `defineScheduledComponent` | function | A node-cron job as an `IScheduledComponent` (an `IComponent` with `settled()`) |
| `IComponent`, `ComponentStatus`, `ComponentEventMap`, `ComponentMetadata`, `ComponentHandler`, `ComponentHandlerFn`, `ComponentHandlerContext`, `ComponentHandleOptions` | type | The component contract and handler types |
| `ICallable`, `ForwardedEvent` | type | A component with a `handle()`, and one forwarded event |
| `IScheduledComponent`, `ScheduledComponentOptions` | type | A scheduled component, and its options |
| `LocalDispatcher`, `RemoteDispatcher`, `RemoteWorker` | class | See [Dispatchers and workers](#dispatchers-and-workers) |
| `IDispatcher`, `DispatchResult`, `LocalDispatchResult`, `LocalDispatcherOptions`, `RemoteDispatcherOptions`, `RemoteWorkerOptions` | type | Dispatcher contract, results and options |
| `MessageBus` | class | Type dispatch over a driver, with hooks |
| `MemoryMessageBusDriver` | class | In-process driver |
| `IMessageBus`, `IMessageBusDriver`, `IMessageBusConsumer` | type | The bus, driver and consumer contracts |
| `Message`, `MessageRouting`, `MessageDelivery`, `MessageHandler`, `MessageHandlers`, `MessageInput` | type | Message shapes |
| `MessageRoutingType` | enum | `WORK` (`'work'`), `PUB_SUB` (`'pubSub'`) |
| `buildMessage`, `isMessage`, `serializeMessage` | function | Message helpers |
| `invokeHook` | function | Calls a hook and ignores a throw or rejection |
| `MessageBusHooks`, `RemoteWorkerHooks`, `ScheduledComponentHooks` | type | Hook types |
| `defineDriverConformance`, `ConformanceFramework`, `ConformanceDriverFactory` | function, type | From `synergos/conformance`: see [Driver conformance](#driver-conformance) |

## Notes

- **Delivery through a broker is at-least-once.** Make handlers idempotent.
- **An unknown key resolves silently** on a component with neither a `'*'` handler nor an
  `options.handle`. Through a dispatcher or a `RemoteWorker`, it is a
  [forwarded event](#forwarded-events).
- **A handler that throws rejects the call.** Through a `RemoteWorker`, the error reaches the bus
  (`onError`) and the driver decides: the memory driver drops the message, the amqp driver retries.
- **`MemoryMessageBusDriver` delivers asynchronously:** handlers run after `publish()` resolved, on
  a later microtask. In a test, wait for the handler (e.g. a `Promise.withResolvers()` it resolves),
  not for `publish()` or `dispatch()`.

## License

Made with 💚

Published under [MIT License](./LICENSE).
