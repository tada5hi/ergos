# ergos-amqp

[![npm version](https://badge.fury.io/js/ergos-amqp.svg)](https://npmjs.com/package/ergos-amqp)

Maps the [ergos](https://npmjs.com/package/ergos) message bus onto RabbitMQ through
[amqp-extension](https://www.npmjs.com/package/amqp-extension).

## Installation

```bash
npm install ergos ergos-amqp --save
```

## Usage

```ts
import { MessageBus } from 'ergos';
import { AmqpMessageBusDriver } from 'ergos-amqp';

const messageBus = new MessageBus({
    driver: new AmqpMessageBusDriver({
        connectionString: 'amqp://localhost',
        defaultTopicExchange: 'app', // exchange of a pubSub routing without namespace
        hooks: {
            onRetry: ({ message, routing, attempt }) => logger.warn(`Retrying ${message.type} in ${routing.key} (attempt ${attempt})`),
            onDrop: ({ message, routing }) => logger.error(`Dropping ${message.type} in ${routing.key}`),
            onMalformed: ({ routing }) => logger.warn(`Dropping a malformed message in ${routing.key}`),
        },
    }),
});
```

| Routing | Exchange | Persistent | Retried |
|---|---|---|---|
| `work` | default (direct), or `namespace` | yes | yes |
| `work` + `ordered` | as `work`, queue with `x-single-active-consumer` | yes | yes |
| `pubSub` | topic `namespace`, else `defaultTopicExchange` | no | no |

Options: `maxAttempts` (default 5), `retryDelay` (backoff base in ms, default 1000, capped at
30s), `prefetchCount` (default 1), `hooks`, or `client` (an amqp-extension `Client`) in place of
`connectionString`. The connection opens on first use; `close()` closes it.

## Hooks

| Hook | Called with | When |
|---|---|---|
| `onRetry` | `{ message, routing, attempt, error }` | a `work` handler threw; the message is re-published (or requeued if that failed) |
| `onDrop` | `{ message, routing, attempt, error }` | a `work` message was dropped (acked) after `maxAttempts`; `error` is the last handler error |
| `onMalformed` | `{ routing, content, error? }` | a delivery is not JSON (`error` is the parse error) or not a message; it is acked |

`attempt` is the attempt that failed (1-based). A hook that throws is ignored (see `invokeHook`
in ergos): it never changes how a message is settled.

## Semantics

- A `work` handler that throws is re-published by amqp-extension with the attempt in the
  `x-attempt` header, after an exponential backoff, and dropped once `maxAttempts` is reached.
  There is no dead-letter queue.
- A redelivery (consumer crash, connection reset) of a message this consumer is still handling
  is not run twice (the copy is held until the original settles); one that is not in flight
  counts as a failed attempt. That guard is per consumer — a redelivery that lands on another
  process runs again. **At-least-once**: a crash between the retry and the ack duplicates a
  message.
- A message that is not JSON or not a bus message is reported to `onMalformed` and dropped (acked).
- `pubSub` consumers use an exclusive temporary queue: messages published while none is
  connected are lost.

The JSON body and AMQP properties are byte-compatible with FLAME Hub's former driver; only the
retry counter moved from the body (`metadata.attempt`) to the `x-attempt` header.

## License

Published under [MIT License](./LICENSE).
