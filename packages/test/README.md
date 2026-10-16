# @synergos/test

[![npm version](https://badge.fury.io/js/@synergos%2Ftest.svg)](https://npmjs.com/package/@synergos/test)

**Test helpers for [synergos](https://npmjs.com/package/synergos).** The driver conformance suite,
which pins the `IMessageBusDriver` contract as test cases, and the fakes synergos' own specs use.
It works with any test framework: vitest, jest or `node:test`.

## Installation

```bash
npm install @synergos/test --save-dev
```

`synergos` is a peer dependency. ESM-only, Node.js `>=22`.

## Driver conformance

`defineDriverConformance(framework, createDriver)` registers the driver contract's cases (see
synergos' [Drivers](https://github.com/tada5hi/synergos/tree/master/packages/synergos#drivers)).
Hand it your framework's `describe` / `it` and a driver factory. It asserts with `node:assert`,
whose `AssertionError` fails a test in any runner.

vitest:

```typescript
import { describe, it } from 'vitest';
import { defineDriverConformance } from '@synergos/test';

describe('MyMessageBusDriver', () => {
    defineDriverConformance({ describe, it }, () => new MyMessageBusDriver());
});
```

jest:

```typescript
import { describe, it } from '@jest/globals';
import { defineDriverConformance } from '@synergos/test';

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
import { RemoteDispatcher } from 'synergos';
import { FakeMessageBus } from '@synergos/test';

const messageBus = new FakeMessageBus();
await new RemoteDispatcher({ messageBus, routing: { type: 'work', key: 'builder' } })
    .dispatch('build', { id: '1' });

messageBus.published[0].type; // 'build'
```

## License

Made with 💚

Published under [MIT License](./LICENSE).
