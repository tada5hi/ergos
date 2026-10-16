<p align="center">
    <img src="https://raw.githubusercontent.com/tada5hi/synergos/master/.github/assets/logo.svg" alt="synergos" width="128" height="128" />
</p>

<h1 align="center">synergos</h1>

<p align="center">
    <b>Components with a lifecycle, scheduled jobs, and the message bus between them.</b><br>
    A <code>Component</code> maps command keys to handlers; callers reach it in-process or over a bus,<br>
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
    <a href="#callers">Callers</a>
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
- **How it is reached** is a caller. `DirectCaller` calls it in-process, `DispatchCaller` publishes
  a command, `WorkerCaller` consumes commands into it and publishes its replies.
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
- [Callers](#callers)
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
caller's `options.handle`. That is how replies leave a component: a `WorkerCaller` publishes them,
a `DirectCaller` collects them. The parent's metadata (such as a `correlationId`) is merged into
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
```

- `start()` runs a first pass before scheduling. Pass `runOnStart: false` to wait for the first tick.
- Passes never overlap: a tick while a pass is still running is skipped.
- A failing pass goes to `hooks.onError` and never rejects. The next tick simply runs again.
- `stop()` during the first pass prevents the schedule from being created. It does not wait for a
  pass in flight.

## Message bus

`MessageBus` dispatches messages by `type` to handlers and hands publishing and consuming to a
driver. Callers and components depend on the `IMessageBus` contract, not the class.

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

A message is `{ id, type, data, metadata: { timestamp, routing, persistent? } }`. `buildMessage()`
fills in the `id` and `timestamp`, `isMessage()` checks the shape, and `serializeMessage()` writes
JSON that keeps `Error`s as `{ name, message, code? }`.

### Routing

| Field | Purpose |
|---|---|
| `type` | `'work'`: each message goes to one consumer (round-robin). `'pubSub'`: each message goes to every consumer |
| `key` | The queue (work) or routing key (pubSub) |
| `namespace` | Optional. Separates routings with the same key, e.g. an exchange name in the amqp driver |
| `ordered` | `work` only: one consumer at a time, in publish order, with failover to another replica |

### Consuming

`consume(routing, handlers)` picks the handler for the message's `type`, or `'*'` for every other
type. A message that no handler accepts is settled (acked) without error and reported to
`onUnhandled`. `consumeAny(routing, handler)` is `consume()` with a single `'*'` handler. Both
resolve to a consumer whose `cancel()` resolves once the handlers in flight have settled.

### Drivers

| Driver | Package | Use it for |
|---|---|---|
| `MemoryMessageBusDriver` | `synergos` | Tests and single-process apps. `publish()` awaits the handlers, rejects with their error and resolves `false` when no consumer matched |
| `AmqpMessageBusDriver` | [`@synergos/amqp`](https://npmjs.com/package/@synergos/amqp) | RabbitMQ: persistent work queues, retries with backoff, topic exchanges for pubSub |

A driver implements `IMessageBusDriver`: `publish(routing, message)`, `consume(routing, handler)`
and an optional `close()`.

## Callers

<p align="center">
    <img src="https://raw.githubusercontent.com/tada5hi/synergos/master/.github/assets/architecture.svg" alt="A DispatchCaller publishes a build command through the message bus to a WorkerCaller, whose component replies with buildFinished" width="100%" />
</p>

| Caller | Where the component runs | Replies |
|---|---|---|
| `DirectCaller` | In this process | `callAndWait()` returns them by key |
| `DispatchCaller` | Wherever a `WorkerCaller` consumes the routing | Consumed separately, from the worker's `publishRouting` |
| `WorkerCaller` | Wraps the component and consumes `consumeRouting` into it | Published to `publishRouting` |

```typescript
import { DirectCaller, DispatchCaller, WorkerCaller } from 'synergos';

// in-process
const direct = new DirectCaller(new Builder());
const replies = await direct.callAndWait('build', { id: '1' }, {});
replies.buildFinished; // { id: '1' }

// worker side
const worker = new WorkerCaller(new Builder(), {
    consumeRouting: { type: 'work', key: 'builder' },
    publishRouting: { type: 'work', key: 'builder-events' },
    messageBus,
});
await worker.start();

// caller side
const dispatch = new DispatchCaller<BuilderEvents>({
    routing: { type: 'work', key: 'builder' },
    messageBus,
});
await dispatch.call('build', { id: '1' }, {});

await worker.stop(); // cancels the consumer, waits for the handler in flight, stops the component
```

A `WorkerCaller` is itself an `IComponent`: start and stop it with the rest of your application.
`DirectCaller` assigns a `correlationId` when the metadata has none.

## Hooks

There is no logger option. Each class takes an optional `hooks` object of typed observers. Wire them
to your logger, metrics or tracing:

| Options of | Hook | When |
|---|---|---|
| `MessageBus` | `onPublish(message)` | Before a message is handed to the driver |
| | `onConsume(message, routing)` | A message arrived, before dispatch |
| | `onUnhandled(message, routing)` | No handler (and no `'*'`) accepted it. It is acked |
| | `onError(error, message, routing)` | A handler threw. The error is rethrown to the driver afterwards |
| `DispatchCaller` | `onUndelivered(message)` | `publish()` resolved `false`: no consumer matched (memory driver) |
| `WorkerCaller` | `onUnrouted(key, data, metadata)` | A reply was dropped because no `publishRouting` is set |
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
| `defineScheduledComponent` | function | A node-cron job as an `IComponent` |
| `IComponent`, `ComponentStatus`, `ComponentEventMap`, `ComponentMetadata`, `ComponentHandler`, `ComponentHandlerFn`, `ComponentHandlerContext`, `ComponentHandleOptions` | type | The component contract and handler types |
| `DirectCaller`, `DispatchCaller`, `WorkerCaller` | class | The callers, see [Callers](#callers) |
| `ICaller`, `DirectCallerResponse`, `DispatchCallerOptions`, `WorkerCallerOptions` | type | Caller contract and options |
| `MessageBus` | class | Type dispatch over a driver, with hooks |
| `MemoryMessageBusDriver` | class | In-process driver |
| `IMessageBus`, `IMessageBusDriver`, `IMessageBusConsumer` | type | The bus, driver and consumer contracts |
| `Message`, `MessageRouting`, `MessageHandler`, `MessageHandlers`, `MessageInput` | type | Message shapes |
| `MessageRoutingType` | enum | `WORK` (`'work'`), `PUB_SUB` (`'pubSub'`) |
| `buildMessage`, `isMessage`, `serializeMessage` | function | Message helpers |
| `invokeHook` | function | Calls a hook and ignores a throw or rejection |
| `MessageBusHooks`, `DispatchCallerHooks`, `WorkerCallerHooks`, `ScheduledComponentHooks` | type | Hook types |

## Notes

- **Delivery through a broker is at-least-once.** Make handlers idempotent.
- **An unknown key resolves silently** on a component with neither a `'*'` handler nor an
  `options.handle`. A `WorkerCaller` acks such a command.
- **A handler that throws rejects the call.** Through a `WorkerCaller`, the error reaches the bus
  (`onError`) and the driver decides: the memory driver rejects `publish()`, the amqp driver retries.
- **`MemoryMessageBusDriver` awaits end to end:** `publish()` resolves after every matching
  handler has finished, replies included, which makes tests deterministic.

## License

Made with 💚

Published under [MIT License](./LICENSE).
