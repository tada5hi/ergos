<p align="center">
    <img src=".github/assets/logo.svg" alt="" width="96" height="96">
</p>

<h1 align="center">ergos</h1>

<p align="center">
    <a href="https://npmjs.com/package/ergos"><img src="https://badge.fury.io/js/ergos.svg" alt="npm version"></a>
    <a href="https://codecov.io/gh/Tada5hi/ergos"><img src="https://codecov.io/gh/Tada5hi/ergos/branch/master/graph/badge.svg?token=4KNSG8L13V" alt="Coverage"></a>
    <a href="https://github.com/Tada5hi/ergos"><img src="https://github.com/Tada5hi/ergos/workflows/CI/badge.svg" alt="Master Workflow"></a>
    <a href="https://snyk.io/test/github/Tada5hi/ergos?targetFile=packages/ergos/package.json"><img src="https://snyk.io/test/github/Tada5hi/ergos/badge.svg?targetFile=packages/ergos/package.json" alt="Known Vulnerabilities"></a>
    <a href="https://conventionalcommits.org"><img src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&amp;logoColor=white" alt="Conventional Commits"></a>
</p>

Components with a `start` / `stop` / `status` lifecycle and optional command handlers,
scheduled background jobs, and the message bus that routes commands and replies between them.

## Packages

| Package | Description |
|---|---|
| [`ergos`](./packages/ergos) | Components, scheduled components, the message bus (`MessageBus`, `IMessageBus`, `MemoryMessageBusDriver`) and the direct / dispatch / worker callers |
| [`@ergos/amqp`](./packages/amqp) | `AmqpMessageBusDriver`: the message bus over RabbitMQ via [amqp-extension](https://www.npmjs.com/package/amqp-extension) |

```bash
npm install ergos --save
npm install @ergos/amqp --save # for RabbitMQ
```

## Quick Start

```ts
import { Component, DispatchCaller, MessageBus, WorkerCaller } from 'ergos';
import { AmqpMessageBusDriver } from '@ergos/amqp';

const messageBus = new MessageBus({
    driver: new AmqpMessageBusDriver({ connectionString: 'amqp://localhost', defaultTopicExchange: 'app' }),
    hooks: { onError: (error, message) => console.error(message.type, error) },
});

const builder = new Component();
builder.mount('build', async (data, context) => {
    await context.handle('buildFinished', data); // a reply
});

const worker = new WorkerCaller(builder, {
    consumeRouting: { type: 'work', key: 'builder' },
    publishRouting: { type: 'work', key: 'builder-events' },
    messageBus,
});
await worker.start();

await new DispatchCaller({ routing: { type: 'work', key: 'builder' }, messageBus })
    .call('build', { id: '1' }, {});
```

See the package READMEs for the full API: [ergos](./packages/ergos/README.md),
[@ergos/amqp](./packages/amqp/README.md).

## Development

```bash
npm ci
npm run build      # every package (nx)
npm run test       # every package (nx)
npm run typecheck  # every package, tests included (nx)
npm run lint
```

## Contributing

Before starting to work on a pull request, it is important to review the guidelines for
[contributing](./CONTRIBUTING.md) and the [code of conduct](./CODE_OF_CONDUCT.md).
These guidelines will help to ensure that contributions are made effectively and are accepted.

## License

Made with 💚

Published under [MIT License](./LICENSE).
