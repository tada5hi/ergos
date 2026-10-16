<p align="center">
    <img src="https://raw.githubusercontent.com/tada5hi/hubwire/master/.github/assets/logo-amqp.svg" alt="@hubwire/amqp" width="128" height="128" />
</p>

<h1 align="center">@hubwire/amqp</h1>

<p align="center">
    <b>Run the hubwire message bus over RabbitMQ.</b><br>
    Work queues with retries and backoff, topic exchanges for pub/sub, and typed hooks<br>
    for every message that is retried, dropped or malformed. Built on <a href="https://www.npmjs.com/package/amqp-extension">amqp-extension</a>.
</p>

<p align="center">
    <a href="https://npmjs.com/package/@hubwire/amqp"><img src="https://badge.fury.io/js/@hubwire%2Famqp.svg" alt="npm version" /></a>
    <a href="https://github.com/tada5hi/hubwire/actions/workflows/main.yml"><img src="https://github.com/tada5hi/hubwire/actions/workflows/main.yml/badge.svg" alt="CI" /></a>
    <a href="https://codecov.io/gh/tada5hi/hubwire"><img src="https://codecov.io/gh/tada5hi/hubwire/branch/master/graph/badge.svg?token=4KNSG8L13V" alt="codecov" /></a>
    <a href="https://conventionalcommits.org"><img src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white" alt="Conventional Commits" /></a>
</p>

<p align="center">
    <a href="#installation"><b>Installation</b></a>
    ·
    <a href="#usage">Usage</a>
    ·
    <a href="#routing">Routing</a>
    ·
    <a href="#retries">Retries</a>
    ·
    <a href="#options">Options</a>
    ·
    <a href="#hooks">Hooks</a>
    ·
    <a href="#notes">Notes</a>
</p>

---

## Why @hubwire/amqp?

[hubwire](https://npmjs.com/package/hubwire) components never see a transport: they get
`(data, context)` and a `MessageBus` routes commands and replies between them. In tests,
`MemoryMessageBusDriver` does the routing in-process. In production you want the messages to
survive a restart, failed handlers to be retried, and several replicas to share the work. This
driver maps the bus onto RabbitMQ so that none of the component code changes:

| Concern | Hand-written amqplib consumer | `AmqpMessageBusDriver` |
|---|---|---|
| **Topology** | Assert an exchange and a queue per routing, on both sides, identically | Derived from the `MessageRouting`, the same way for publisher and consumer |
| **Retries** | `nack` and requeue, which retries immediately and forever | Re-published after an exponential backoff, with the attempt in an `x-attempt` header, dropped after `maxAttempts` |
| **Duplicates** | A redelivery after a reset runs the handler a second time next to the first | A redelivery of a message still in flight on this consumer waits for the original |
| **Garbage** | `JSON.parse` throws inside the consumer | Non-JSON or non-message deliveries are acked and reported to `onMalformed` |
| **Ordering** | Single active consumer, configured by hand on every declaration | `ordered: true` on the routing |
| **Reconnects** | Rebuild connection, channels and topology yourself | Handled by amqp-extension, topology is replayed on reconnect |
| **Observability** | `console.log` in the consumer | `onRetry`, `onDrop` and `onMalformed` hooks |

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [Routing](#routing)
- [Retries](#retries)
- [Options](#options)
- [Hooks](#hooks)
- [API](#api)
- [Notes](#notes)
- [License](#license)

## Installation

```bash
npm install hubwire @hubwire/amqp --save
```

`hubwire` is a peer dependency. The package is ESM-only and requires Node.js `>=22`.

## Usage

Pass the driver to a `MessageBus`. Everything built on that bus (`RemoteDispatcher`, `RemoteWorker`,
`consume()`) now goes through RabbitMQ:

```typescript
import { MessageBus, RemoteWorker } from 'hubwire';
import { AmqpMessageBusDriver } from '@hubwire/amqp';

const driver = new AmqpMessageBusDriver({
    connectionString: 'amqp://<user>:<password>@<host>',
    defaultTopicExchange: 'app', // exchange for pubSub routings without a namespace
    hooks: {
        onRetry: ({ message, routing, attempt }) => logger.warn(`retrying ${message.type} in ${routing.key} (attempt ${attempt})`),
        onDrop: ({ message, routing, error }) => logger.error(`dropping ${message.type} in ${routing.key}`, error),
        onMalformed: ({ routing }) => logger.warn(`dropping a malformed delivery in ${routing.key}`),
    },
});

const messageBus = new MessageBus({ driver });

const worker = new RemoteWorker(new Builder(), {
    messageBus,
    consume: { type: 'work', key: 'builder' },
    publish: { type: 'work', key: 'builder-events' },
});
await worker.start();

// on shutdown
await worker.stop();
await driver.close();
```

The connection opens on first use, not in the constructor. To share a connection with other code,
pass an amqp-extension `Client` as `client` instead of `connectionString`.

## Routing

Each `MessageRouting` maps onto an exchange and a queue:

| Routing | Exchange | Queue | Persistent | Retried |
|---|---|---|---|---|
| `{ type: 'work', key }` | Default (direct) exchange | Durable queue named `key`, shared by all consumers | yes | yes |
| `{ type: 'work', key, ordered: true }` | Default (direct) exchange | As above, with `x-single-active-consumer` | yes | yes |
| `{ type: 'work', key, namespace }` | Default (direct) exchange | Durable queue named `namespace/key` (a `/` in `namespace` is rejected), shared by all consumers | yes | yes |
| `{ type: 'pubSub', key }` | Topic exchange `namespace`, else `defaultTopicExchange` | Exclusive temporary queue per consumer, bound to `key` | no | no |
| `{ type: 'pubSub', key, queue }` (consume) | As above | Durable queue named `queue`, bound to `key`, shared by the consumers naming it | no | yes |

A routing's `persistent` overrides that column, and a message's `metadata.persistent` overrides both. Its `metadata.expiresAt`
becomes the AMQP `expiration` (the remaining ms), so the broker drops it unconsumed; one that still
arrives late is dropped by `MessageBus` (`onExpired`). Only a `work` routing and a `pubSub` `queue`
keep messages while no consumer is connected and split them between replicas.

A `pubSub` `queue` is a durable fan-out subscription: each service names its own queue (e.g.
`hub-core-authup-events`) and gets its own copy, its replicas share it. Only the consumer passes
`queue`; the publisher's routing stays `{ type: 'pubSub', key, namespace }` and declares no queue, so
the two never conflict. The queue keeps messages from the first consume on. Set `persistent: true`
on the publisher's routing (or `metadata.persistent: true` on a message) for them to survive a
broker restart; a `RemoteWorker` drops the command's `metadata.persistent` from the events it
forwards, so give its `publish` routing `persistent: true`.

`publish()` resolves once the broker has confirmed the message, and rejects when it refuses
it or the driver was closed. The driver passes the
[driver conformance](https://github.com/tada5hi/hubwire/tree/master/packages/test#driver-conformance) suite of `@hubwire/test`.

## Retries

<p align="center">
    <img src="https://raw.githubusercontent.com/tada5hi/hubwire/master/.github/assets/amqp-retry.svg" alt="A work message that throws is re-published after a backoff until maxAttempts, then dropped; malformed deliveries are acked" width="100%" />
</p>

When a `work` handler throws, the error first reaches `MessageBus`' `onError` hook. amqp-extension
then re-publishes the message with `x-attempt` incremented, after an exponential backoff starting
at `retryDelay` and capped at 30 seconds, and reports it to `onRetry`. Once `maxAttempts` is
reached the message is acked and reported to `onDrop`. There is no dead-letter queue.

If the re-publish itself fails, the message is requeued and comes back as a redelivery.
The re-publish goes to the end of the queue, so on an `ordered` routing a retried message is
handled after the ones published behind it.

A handler sees `message.metadata.delivery = { attempt, maxAttempts }`: for `work`, the 1-based
attempt from `x-attempt` and the driver's `maxAttempts` (likewise for a `pubSub` `queue`); for a
plain `pubSub`, which is not retried,
`{ attempt: 1, maxAttempts: 1 }`. So it can tell its last attempt apart, e.g. to report a failure
instead of throwing once more. The value is set on consume only and is never published.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `connectionString` | `string` | | AMQP URL. Either this or `client` |
| `client` | `IAmqpClient` | | An amqp-extension `Client` (or anything with the same `of` / `publish` / `consume` / `close`) |
| `defaultTopicExchange` | `string` | required | Topic exchange for `pubSub` routings without a `namespace` |
| `maxAttempts` | `number` | `5` | Delivery attempts of a `work` message before it is dropped |
| `retryDelay` | `number` | `1000` | Base of the exponential backoff in ms, capped at 30 s |
| `prefetchCount` | `number` | `1` | Unacked messages per consumer. Keep `1` for handlers that read-modify-write the same rows |
| `hooks` | `AmqpMessageBusDriverHooks` | | See [Hooks](#hooks) |

## Hooks

| Hook | Called with | When |
|---|---|---|
| `onRetry` | `{ message, routing, attempt, error }` | A `work` (or `pubSub` `queue`) handler threw and the message was re-published (or requeued, if that failed) |
| `onDrop` | `{ message, routing, attempt, error }` | A `work` (or `pubSub` `queue`) message was acked and dropped after `maxAttempts`. `error` is the last handler error |
| `onMalformed` | `{ routing, content, error? }` | A delivery is not JSON (`error` is the parse error) or not a bus message. It is acked |

`attempt` is the attempt that failed, 1-based. A hook that throws is ignored (see `invokeHook` in
hubwire): it never changes how a message is settled.

## API

| Export | Kind | Purpose |
|---|---|---|
| `AmqpMessageBusDriver` | class | `IMessageBusDriver` over amqp-extension: `publish()`, `consume()`, `close()` |
| `AmqpMessageBusDriverOptions` | type | Constructor options, see [Options](#options) |
| `AmqpMessageBusDriverHooks` | type | `onRetry`, `onDrop`, `onMalformed` |
| `AmqpFailedMessage`, `AmqpMalformedMessage` | type | Hook arguments |
| `IAmqpClient` | type | The part of amqp-extension's `Client` the driver uses |

## Notes

- **Delivery is at-least-once.** A crash between a retry and its ack duplicates the message, and the
  redelivery guard is per consumer: a redelivery that lands on another process runs again. Make
  handlers idempotent.
- **A redelivery that is not in flight counts as a failed attempt**, e.g. after the consumer
  crashed mid-handler.
- **`pubSub` messages published while no consumer is connected are lost**, unless they are consumed
  through a `queue` that was declared before. Without one, each consumer has its own exclusive
  temporary queue.
- **Wire compatibility:** the JSON body and AMQP properties are byte-compatible with FLAME Hub's
  former driver. Only the retry counter moved, from the body (`metadata.attempt`) to the
  `x-attempt` header; on consume the driver reports it as `metadata.delivery.attempt`. A counter an
  older producer left in the body stays in `metadata.attempt` and is ignored.

## License

Made with 💚

Published under [MIT License](./LICENSE).
