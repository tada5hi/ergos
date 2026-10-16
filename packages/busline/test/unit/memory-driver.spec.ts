import { describe, expect, it } from 'vitest';
import { MemoryMessageBusDriver, buildMessage } from '../../src';
import type { Message, MessageRouting } from '../../src';
import { drain } from '@busline/test';

const work: MessageRouting = { type: 'work', key: 'jobs' };

const message = (routing: MessageRouting) => buildMessage({ type: 'run', metadata: { routing } });

describe('src/message-bus/memory', () => {
    it('should keep a WORK message until a consumer arrives', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: Message[] = [];
        const published = message(work);

        await driver.publish(work, published);
        await driver.consume(work, (received) => { seen.push(received); });
        await drain();

        expect(seen.map((received) => received.id)).toEqual([published.id]);
    });

    it('should keep a PUB_SUB message for a named queue while none of its consumers runs', async () => {
        const driver = new MemoryMessageBusDriver();
        const pubSub: MessageRouting = { type: 'pubSub', key: 'events' };
        const subscription: MessageRouting = { ...pubSub, queue: 'hub' };
        const seen: Message[] = [];
        const consumer = await driver.consume(subscription, () => {});
        await consumer.cancel();

        const published = message(pubSub);
        await driver.publish(pubSub, published);
        await driver.consume(subscription, (received) => { seen.push(received); });
        await drain();

        expect(seen.map((received) => received.id)).toEqual([published.id]);
    });

    it('should drop a message without consumer on a PUB_SUB routing', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: string[] = [];
        const pubSub: MessageRouting = { type: 'pubSub', key: 'events' };

        await driver.publish(pubSub, message(pubSub));
        await driver.consume(pubSub, () => { seen.push('pubSub'); });
        await drain();

        expect(seen).toEqual([]);
    });

    it('should keep a namespaced WORK message in a queue of its own until a consumer arrives', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: string[] = [];
        const namespaced: MessageRouting = { ...work, namespace: 'tasks' };
        await driver.consume(work, () => { seen.push('plain'); });

        await driver.publish(namespaced, message(namespaced));
        await driver.consume(namespaced, () => { seen.push('a'); });
        await driver.consume(namespaced, () => { seen.push('b'); });
        await driver.publish(namespaced, message(namespaced));
        await drain();

        expect(seen).toEqual(['a', 'b']);
    });

    it('should round-robin WORK messages, and keep an ordered routing on one consumer', async () => {
        const driver = new MemoryMessageBusDriver();
        const ordered: MessageRouting = {
            ...work, 
            key: 'replies', 
            ordered: true, 
        };
        const seen: string[] = [];
        await driver.consume(work, () => { seen.push('a'); });
        await driver.consume(work, () => { seen.push('b'); });
        await driver.consume(ordered, () => { seen.push('first'); });
        await driver.consume(ordered, () => { seen.push('second'); });

        for (let i = 0; i < 4; i++) {
            await driver.publish(work, message(work));
        }
        await driver.publish(ordered, message(ordered));
        await driver.publish(ordered, message(ordered));
        await drain();

        expect(seen).toEqual(['a', 'b', 'a', 'b', 'first', 'first']);
    });

    it('should ignore a queue on publish, like amqp (fan out to every subscription)', async () => {
        const driver = new MemoryMessageBusDriver();
        const pubSub: MessageRouting = { type: 'pubSub', key: 'events' };
        const seen: string[] = [];
        await driver.consume(pubSub, () => { seen.push('plain'); });
        await driver.consume({ ...pubSub, queue: 'hub' }, () => { seen.push('hub'); });
        await driver.consume({ ...pubSub, queue: 'other' }, () => { seen.push('other'); });

        await driver.publish({ ...pubSub, queue: 'hub' }, message(pubSub));
        await driver.publish({ ...pubSub, queue: 'ghost' }, message(pubSub));
        await drain();

        expect(seen.sort()).toEqual(['hub', 'hub', 'other', 'other', 'plain', 'plain']);
    });

    it('should run the handlers of an ordered routing one at a time, also across a failover', async () => {
        const driver = new MemoryMessageBusDriver();
        const ordered: MessageRouting = {
            ...work, 
            key: 'replies', 
            ordered: true, 
        };
        const log: string[] = [];
        const release = Promise.withResolvers<void>();
        const first = await driver.consume(ordered, async (received) => {
            log.push(`start ${received.type}`);
            if (received.type === 'a') {
                await release.promise;
            }
            log.push(`end ${received.type}`);
        });
        await driver.consume(ordered, (received) => { log.push(`second ${received.type}`); });

        await driver.publish(ordered, buildMessage({ type: 'a', metadata: { routing: ordered } }));
        await driver.publish(ordered, buildMessage({ type: 'b', metadata: { routing: ordered } }));
        await drain();
        expect(log).toEqual(['start a']);

        const cancelled = first.cancel();
        await driver.publish(ordered, buildMessage({ type: 'c', metadata: { routing: ordered } }));
        await drain();
        expect(log).toEqual(['start a']);

        release.resolve();
        await cancelled;
        await drain();
        expect(log).toEqual(['start a', 'end a', 'second b', 'second c']);
    });

    it('should keep a routing ordered when a publish declared its queue first', async () => {
        const driver = new MemoryMessageBusDriver();
        const plain: MessageRouting = { ...work, key: 'replies' };
        const ordered: MessageRouting = { ...plain, ordered: true };
        const seen: string[] = [];

        await driver.publish(plain, message(plain));
        await driver.consume(ordered, () => { seen.push('first'); });
        await driver.consume(ordered, () => { seen.push('second'); });
        await driver.publish(plain, message(plain));
        await driver.publish(plain, message(plain));
        await drain();

        expect(seen).toEqual(['first', 'first', 'first']);
    });

    it('should stop delivering to a cancelled consumer', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: string[] = [];
        const a = await driver.consume(work, () => { seen.push('a'); });
        await driver.consume(work, () => { seen.push('b'); });

        await a.cancel();
        await driver.publish(work, message(work));
        await driver.publish(work, message(work));
        await drain();

        expect(seen).toEqual(['b', 'b']);
    });

    it('should hand the handler a copy with delivery info, leaving the published metadata as is', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: Message[] = [];
        await driver.consume(work, (received) => { seen.push(received); });
        const published = message(work);

        await driver.publish(work, published);
        await drain();

        expect(seen[0]?.metadata.delivery).toEqual({ attempt: 1, maxAttempts: 1 });
        expect(published.metadata).not.toHaveProperty('delivery');
    });
});
