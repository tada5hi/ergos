import { describe, expect, it } from 'vitest';
import { MemoryMessageBusDriver, buildMessage } from '../../src';
import type { Message, MessageRouting } from '../../src';
import { defineDriverConformance } from '../../src/conformance';
import { drain } from './fakes/drain';

const work: MessageRouting = { type: 'work', key: 'jobs' };

const message = (routing: MessageRouting) => buildMessage({ type: 'run', metadata: { routing } });

describe('src/message-bus/memory', () => {
    defineDriverConformance({ describe, it }, () => new MemoryMessageBusDriver());

    it('should keep a WORK message until a consumer arrives', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: Message[] = [];
        const published = message(work);

        await driver.publish(work, published);
        await driver.consume(work, (received) => { seen.push(received); });
        await drain();

        expect(seen.map((received) => received.id)).toEqual([published.id]);
    });

    it('should drop a message without consumer on a namespaced WORK or a PUB_SUB routing', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: string[] = [];
        const namespaced: MessageRouting = { ...work, namespace: 'tasks' };
        const pubSub: MessageRouting = { type: 'pubSub', key: 'events' };

        await driver.publish(namespaced, message(namespaced));
        await driver.publish(pubSub, message(pubSub));
        await driver.consume(namespaced, () => { seen.push('namespaced'); });
        await driver.consume(pubSub, () => { seen.push('pubSub'); });
        await drain();

        expect(seen).toEqual([]);
    });

    it('should fan a namespaced WORK message out like amqp (an exclusive queue per consumer)', async () => {
        const driver = new MemoryMessageBusDriver();
        const seen: string[] = [];
        const namespaced: MessageRouting = { ...work, namespace: 'tasks' };
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

    it('should hand the handler a copy with delivery info, leaving the published message as is', async () => {
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
