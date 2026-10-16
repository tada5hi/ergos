/// <reference types="node" />
// ponytail: @types/node comes in through vitest, not a dependency of its own
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { buildMessage } from '../message-bus';
import type {
    IMessageBusDriver,
    Message,
    MessageHandler,
    MessageRouting,
} from '../message-bus';
import type { ConformanceDriverFactory, ConformanceFramework } from './types';

/**
 * A handler that records each message and resolves `done` once `count` arrived.
 */
function collect(count: number) {
    const received: Message[] = [];
    const done = Promise.withResolvers<Message[]>();
    const handler: MessageHandler = (message) => {
        received.push(message);
        if (received.length === count) {
            done.resolve(received);
        }
    };

    return { done: done.promise, handler };
}

function routing(type: MessageRouting['type'], ordered?: boolean): MessageRouting {
    // a key of its own per case: a shared broker must not mix cases
    return {
        type,
        key: `conformance-${crypto.randomUUID()}`,
        ...(ordered ? { ordered } : {}),
    };
}

function message(to: MessageRouting, type = 'run'): Message {
    return buildMessage({ type, metadata: { routing: to } });
}

/**
 * The delivery contract every IMessageBusDriver keeps, as test cases:
 * `defineDriverConformance({ describe, it }, () => new MyDriver())`.
 */
export function defineDriverConformance(
    { describe, it }: ConformanceFramework,
    createDriver: ConformanceDriverFactory,
): void {
    const run = (name: string, fn: (driver: IMessageBusDriver) => Promise<void>) => it(name, async () => {
        const driver = await createDriver();
        try {
            await fn(driver);
        } finally {
            await driver.close();
        }
    });

    describe('message bus driver conformance', () => {
        run('should deliver each WORK message to exactly one consumer', async (driver) => {
            const to = routing('work');
            const all = collect(4);
            await driver.consume(to, all.handler);
            await driver.consume(to, all.handler);

            const published = [message(to), message(to), message(to), message(to)];
            for (const item of published) {
                await driver.publish(to, item);
            }

            const ids = (await all.done).map((item) => item.id);
            assert.deepEqual(ids.sort(), published.map((item) => item.id).sort());
        });

        run('should fan a PUB_SUB message out to every consumer', async (driver) => {
            const to = routing('pubSub');
            const a = collect(1);
            const b = collect(1);
            await driver.consume(to, a.handler);
            await driver.consume(to, b.handler);

            const published = message(to);
            await driver.publish(to, published);

            const [[fromA], [fromB]] = await Promise.all([a.done, b.done]);
            assert.equal(fromA?.id, published.id);
            assert.equal(fromB?.id, published.id);
        });

        run('should resolve publish() when the handler throws', async (driver) => {
            const to = routing('work');
            const called = Promise.withResolvers<void>();
            await driver.consume(to, () => {
                called.resolve();
                throw new Error('handler');
            });

            await driver.publish(to, message(to));
            await called.promise;
        });

        run('should resolve cancel() only after the handler in flight settled', async (driver) => {
            const to = routing('work');
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const order: string[] = [];
            const consumer = await driver.consume(to, async () => {
                entered.resolve();
                await release.promise;
                order.push('handled');
            });

            await driver.publish(to, message(to));
            await entered.promise;
            const cancelled = consumer.cancel().then(() => { order.push('cancelled'); });

            // ponytail: one event-loop turn for an early cancel() to show, not a proof it never does
            await tick();
            assert.deepEqual(order, []);

            release.resolve();
            await cancelled;
            assert.deepEqual(order, ['handled', 'cancelled']);
        });

        run('should reject a publish after close()', async (driver) => {
            const to = routing('work');
            await driver.close();

            await assert.rejects(driver.publish(to, message(to)));
        });

        run('should keep publish order on an ordered WORK routing', async (driver) => {
            const to = routing('work', true);
            const all = collect(5);
            await driver.consume(to, all.handler);

            const types = ['a', 'b', 'c', 'd', 'e'];
            for (const type of types) {
                await driver.publish(to, message(to, type));
            }

            assert.deepEqual((await all.done).map((item) => item.type), types);
        });

        run('should report attempt 1 and maxAttempts >= 1 on a first delivery', async (driver) => {
            for (const to of [routing('work'), routing('pubSub')]) {
                const one = collect(1);
                await driver.consume(to, one.handler);
                await driver.publish(to, message(to));

                const [received] = await one.done;
                assert.equal(received?.metadata.delivery?.attempt, 1);
                assert.ok((received?.metadata.delivery?.maxAttempts ?? 0) >= 1);
            }
        });
    });
}
