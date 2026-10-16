# ergos

[![npm version](https://badge.fury.io/js/ergos.svg)](https://npmjs.com/package/ergos)

Components with a `start` / `stop` / `status` lifecycle and optional command handlers,
scheduled background jobs, and the message bus that routes commands and replies between them.

For an AMQP (RabbitMQ) driver, see [`@ergos/amqp`](https://npmjs.com/package/@ergos/amqp).

## Installation

```bash
npm install ergos --save
```

## Component

A `Component` maps command keys to handlers. A handler may emit child events through
`context.handle`; an event no handler (and no `'*'`) accepts goes to the caller's
`options.handle` — that is how replies leave a component. An unknown key with neither
resolves silently.

```ts
import { Component } from 'ergos';
import type { ComponentMetadata } from 'ergos';

type EventMap = {
    build: [{ id: string }, ComponentMetadata],
    buildFinished: [{ id: string }, ComponentMetadata],
};

class Builder extends Component<EventMap> {
    constructor() {
        super();
        this.mount('build', async (data, context) => {
            // ... work ...
            await context.handle('buildFinished', data);
        });
    }
}
```

`status()` reports `lastSuccessAt` / `runningSince` of top-level calls. `start()` and
`stop()` are no-ops unless overridden.

## Scheduled component

```ts
import { defineScheduledComponent } from 'ergos';

const cleaner = defineScheduledComponent({
    schedule: '* * * * *', // node-cron
    run: () => repository.deleteExpired(new Date()),
    hooks: { onError: (error) => logger.warn('cleaner pass failed', error) },
});

await cleaner.start(); // one pass, then every tick (no overlap)
await cleaner.stop();
```

A failing pass is reported to `hooks.onError` and never rejects. `stop()` during the first
pass prevents the schedule from being created; it does not wait for a pass in flight.

## Message bus and callers

```ts
import {
    DispatchCaller,
    MemoryMessageBusDriver,
    MessageBus,
    WorkerCaller,
} from 'ergos';

const messageBus = new MessageBus({ driver: new MemoryMessageBusDriver() });

// worker side: consume commands, publish replies
const worker = new WorkerCaller(new Builder(), {
    consumeRouting: { type: 'work', key: 'builder' },
    publishRouting: { type: 'work', key: 'builder-events' },
    messageBus,
});
await worker.start();

// caller side
const caller = new DispatchCaller<EventMap>({
    routing: { type: 'work', key: 'builder' },
    messageBus,
});
await caller.call('build', { id: '1' }, {});

await worker.stop(); // waits for the handler in flight
```

`DirectCaller` calls a component in-process; `callAndWait()` returns the events it emitted,
by key. Callers depend on the `IMessageBus` contract (`publish`, `consume`, `consumeAny`),
which `MessageBus` implements.

`consume(routing, handlers)` dispatches by message type; `'*'` catches every other type, and a
message no handler accepts is settled (acked) without error. `consumeAny(routing, handler)` is
`consume()` with a single `'*'` handler.

Routing types: `work` (one consumer per message, round-robin) and `pubSub` (every consumer).
`MemoryMessageBusDriver` is in-process; `publish()` resolves `false` when no consumer matched.
Delivery through a broker is at-least-once — handlers must be idempotent.

## Hooks

There is no logger option. Each class takes an optional `hooks` object of typed observers —
wire them to your logger or metrics:

| Options of                  | Hooks |
|-----------------------------|-------|
| `MessageBus`                | `onPublish(message)`, `onConsume(message, routing)`, `onUnhandled(message, routing)`, `onError(error, message, routing)` |
| `DispatchCaller`            | `onUndelivered(message)` — `publish()` resolved `false` |
| `WorkerCaller`              | `onUnrouted(key, data, metadata)` — a reply dropped for lack of `publishRouting` |
| `defineScheduledComponent`  | `onError(error)` — a pass failed |

```ts
const messageBus = new MessageBus({
    driver,
    hooks: {
        onError: (error, message, routing) => logger.error(`${message.type} in ${routing.key} failed`, error),
        onUnhandled: (message, routing) => logger.debug(`No handler for ${message.type} in ${routing.key}`),
    },
});
```

Hooks only observe. A hook that throws, or returns a promise that rejects, is ignored — it can
never turn an ack into a retry or reject a `publish()`. `MessageBus`' `onError` runs before the
handler's error is rethrown to the driver.

## License

Published under [MIT License](./LICENSE).
