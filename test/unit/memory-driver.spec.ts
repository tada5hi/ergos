import { describe, expect, it } from 'vitest';
import { MemoryMessageBusDriver, buildMessageBusPayload } from '../../src';
import type { MessageBusRouting } from '../../src';

const work: MessageBusRouting = { type: 'work', key: 'jobs' };
const pubSub: MessageBusRouting = { type: 'pubSub', key: 'events' };

const message = (routing: MessageBusRouting) => buildMessageBusPayload({ type: 'run', metadata: { routing } });

describe('src/message-bus/memory', () => {
    it('should resolve false when no consumer matches', async () => {
        const driver = new MemoryMessageBusDriver();
        await driver.consume({ ...work, namespace: 'other' }, () => {});
        await expect(driver.publish(work, message(work))).resolves.toBe(false);
    });

    it('should round-robin WORK messages', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: string[] = [];
        await driver.consume(work, () => { seen.push('a'); });
        await driver.consume(work, () => { seen.push('b'); });

        for (let i = 0; i < 4; i++) {
            await expect(driver.publish(work, message(work))).resolves.toBe(true);
        }

        expect(seen).toEqual(['a', 'b', 'a', 'b']);
    });

    it('should fan out PUB_SUB messages', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: string[] = [];
        await driver.consume(pubSub, () => { seen.push('a'); });
        await driver.consume(pubSub, () => { seen.push('b'); });

        await driver.publish(pubSub, message(pubSub));

        expect(seen).toEqual(['a', 'b']);
    });

    it('should stop delivering to a cancelled consumer', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: string[] = [];
        const a = await driver.consume(work, () => { seen.push('a'); });
        await driver.consume(work, () => { seen.push('b'); });

        await a.cancel();
        await driver.publish(work, message(work));
        await driver.publish(work, message(work));

        expect(seen).toEqual(['b', 'b']);
    });

    it('should resolve cancel() only after an in-flight handler settled', async () => {
        const driver = new MemoryMessageBusDriver();
        const blocker = Promise.withResolvers<void>();
        const order: string[] = [];
        const consumer = await driver.consume(work, async () => {
            await blocker.promise;
            order.push('handled');
        });

        const published = driver.publish(work, message(work));
        const cancelled = consumer.cancel().then(() => { order.push('cancelled'); });

        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(order).toEqual([]);

        blocker.resolve();
        await Promise.all([published, cancelled]);
        expect(order).toEqual(['handled', 'cancelled']);
    });

    it('should resolve cancel() even when the in-flight handler fails', async () => {
        const driver = new MemoryMessageBusDriver();
        const consumer = await driver.consume(work, () => { throw new Error('x'); });

        await expect(driver.publish(work, message(work))).rejects.toThrow('x');
        await expect(consumer.cancel()).resolves.toBeUndefined();
    });
});
