<p align="center">
    <img src=".github/assets/logo.svg" alt="" width="96" height="96">
</p>

<h1 align="center">ergos</h1>

<p align="center">
    <a href="https://npmjs.com/package/ergos"><img src="https://badge.fury.io/js/ergos.svg" alt="npm version"></a>
    <a href="https://codecov.io/gh/Tada5hi/ergos"><img src="https://codecov.io/gh/Tada5hi/ergos/branch/master/graph/badge.svg?token=4KNSG8L13V" alt="Coverage"></a>
    <a href="https://github.com/Tada5hi/ergos"><img src="https://github.com/Tada5hi/ergos/workflows/CI/badge.svg" alt="Master Workflow"></a>
    <a href="https://snyk.io/test/github/Tada5hi/ergos?targetFile=package.json"><img src="https://snyk.io/test/github/Tada5hi/ergos/badge.svg?targetFile=package.json" alt="Known Vulnerabilities"></a>
    <a href="https://conventionalcommits.org"><img src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&amp;logoColor=white" alt="Conventional Commits"></a>
</p>

Components with a `start` / `stop` / `status` lifecycle and optional command handlers,
scheduled background jobs, and the message bus that routes commands and replies between them.

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
npm install ergos --save
```

## Usage

### Component

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

### Scheduled component

```ts
import { defineScheduledComponent } from 'ergos';

const cleaner = defineScheduledComponent({
    name: 'cleaner',
    schedule: '* * * * *', // node-cron
    run: () => repository.deleteExpired(new Date()),
    logger,
});

await cleaner.start(); // one pass, then every tick (no overlap)
await cleaner.stop();
```

A failing pass is logged as a warning and never rejects. `stop()` during the first pass
prevents the schedule from being created; it does not wait for a pass in flight.

### Message bus and callers

```ts
import {
    MemoryMessageBusDriver,
    MessageBus,
    MessageBusDispatchComponentCaller,
    MessageBusWorkerComponentCaller,
} from 'ergos';

const messageBus = new MessageBus({ driver: new MemoryMessageBusDriver(), logger });

// worker side: consume commands, publish replies
const worker = new MessageBusWorkerComponentCaller(new Builder(), {
    consumeRouting: { type: 'work', key: 'builder' },
    publishRouting: { type: 'work', key: 'builder-events' },
    messageBus,
});
await worker.start();

// caller side
const caller = new MessageBusDispatchComponentCaller<EventMap>({
    routing: { type: 'work', key: 'builder' },
    messageBus,
});
await caller.call('build', { id: '1' }, {});

await worker.stop(); // waits for the handler in flight
```

`DirectComponentCaller` calls a component in-process; `callAndWait()` returns the events it
emitted, by key.

Routing types: `work` (one consumer per message, round-robin) and `pubSub` (every consumer).
`MemoryMessageBusDriver` is in-process; `publish()` resolves `false` when no consumer matched.
Delivery through a broker is at-least-once — handlers must be idempotent.

### AMQP driver

`ergos/amqp` maps the bus onto [amqp-extension](https://www.npmjs.com/package/amqp-extension)
(an optional peer dependency, `^5.1.0`):

```bash
npm install ergos amqp-extension --save
```

```ts
import { MessageBus } from 'ergos';
import { AmqpMessageBusDriver } from 'ergos/amqp';

const messageBus = new MessageBus({
    driver: new AmqpMessageBusDriver({
        connectionString: 'amqp://localhost',
        defaultTopicExchange: 'app', // exchange of a pubSub routing without namespace
        logger,
    }),
    logger,
});
```

| Routing | Exchange | Persistent | Retried |
|---|---|---|---|
| `work` | default (direct), or `namespace` | yes | yes |
| `work` + `ordered` | as `work`, queue with `x-single-active-consumer` | yes | yes, a redelivered copy is held until the original settles |
| `pubSub` | topic `namespace`, else `defaultTopicExchange` | no | no |

Options: `maxAttempts` (default 5), `retryDelay` (backoff base in ms, default 1000, capped at
30s), `prefetchCount` (default 1), or `client` (an amqp-extension `Client`) in place of
`connectionString`. The connection opens on first use; `close()` closes it.

Semantics:

- A `work` handler that throws is re-published by amqp-extension with the attempt in the
  `x-attempt` header, after an exponential backoff, and dropped once `maxAttempts` is reached.
  There is no dead-letter queue.
- A redelivery (consumer crash, connection reset) of a message this consumer is still handling
  is not run twice; one that is not in flight counts as a failed attempt. That guard is per
  consumer — a redelivery that lands on another process runs again. **At-least-once**: a crash
  between the retry and the ack duplicates a message.
- A message that is not JSON or not a bus payload is logged and dropped (acked).
- `pubSub` consumers use an exclusive temporary queue: messages published while none is
  connected are lost.

## Contributing

Before starting to work on a pull request, it is important to review the guidelines for
[contributing](./CONTRIBUTING.md) and the [code of conduct](./CODE_OF_CONDUCT.md).
These guidelines will help to ensure that contributions are made effectively and are accepted.

## License

Made with 💚

Published under [MIT License](./LICENSE).
