# @busline/test

[![npm version](https://badge.fury.io/js/@busline%2Ftest.svg)](https://npmjs.com/package/@busline/test)

**Test helpers for [busline](https://npmjs.com/package/busline).** The driver conformance suite,
which pins the `IMessageBusDriver` contract as test cases, and the fakes busline's own specs use.
It works with any test framework: vitest, jest or `node:test`.

## Installation

```bash
npm install @busline/test --save-dev
```

`busline` is a peer dependency. ESM-only, Node.js `>=22`.

## Driver conformance

`defineDriverConformance(framework, createDriver)` registers the driver contract's cases (see
busline's [Drivers](https://github.com/tada5hi/busline/tree/master/packages/busline#drivers)).
Hand it your framework's `describe` / `it` and a driver factory. It asserts with `node:assert`,
whose `AssertionError` fails a test in any runner.

vitest:

```typescript
import { describe, it } from 'vitest';
import { defineDriverConformance } from '@busline/test';

describe('MyMessageBusDriver', () => {
    defineDriverConformance({ describe, it }, () => new MyMessageBusDriver());
});
```

jest:

```typescript
import { describe, it } from '@jest/globals';
import { defineDriverConformance } from '@busline/test';

describe('MyMessageBusDriver', () => {
    defineDriverConformance({ describe, it }, () => new MyMessageBusDriver());
});
```

Each case gets a fresh driver from the factory (which may return a promise) and closes it.
`MemoryMessageBusDriver` and `AmqpMessageBusDriver` run the same suite. Every case uses a key of its
own; against a real broker, the durable `conformance-*` queues the `work` and `queue` cases declare
are left behind (`close()` deletes no queue), so point it at a throwaway vhost.

## Fakes

| Export | Purpose |
|---|---|
| `FakeMessageBus` | An `IMessageBus` that records publishes (`published`) and consumes (`consumed`) and never delivers. Set `publishError`, `consumeError`, `cancelError` or `consumeGate` to drive a failure or a race |
| `drain()` | Resolves once the microtasks queued so far ran. The memory driver delivers on microtasks, so a whole publish → handler → publish chain is done |

```typescript
import { RemoteDispatcher } from 'busline';
import { FakeMessageBus } from '@busline/test';

const messageBus = new FakeMessageBus();
await new RemoteDispatcher({ messageBus, routing: { type: 'work', key: 'builder' } })
    .dispatch('build', { id: '1' });

messageBus.published[0].type; // 'build'
```

## License

Made with 💚

Published under [MIT License](./LICENSE).
