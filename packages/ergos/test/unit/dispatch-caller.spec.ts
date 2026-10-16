import { describe, expect, it } from 'vitest';
import { DispatchCaller, MemoryMessageBusDriver, MessageBus } from '../../src';
import type { Message, MessageRouting } from '../../src';
import { FakeMessageBus } from './fakes/message-bus';

const routing: MessageRouting = { type: 'work', key: 'commands' };

describe('src/caller/dispatch', () => {
    it('should publish the command to its routing', async () => {
        const messageBus = new MessageBus({ driver: new MemoryMessageBusDriver() });
        const received: Message[] = [];
        await messageBus.consumeAny(routing, (message) => { received.push(message); });

        const caller = new DispatchCaller({ routing, messageBus });
        await caller.call('run', { id: '1' }, { correlationId: 'c' });

        expect(received).toHaveLength(1);
        expect(received[0]?.type).toBe('run');
        expect(received[0]?.data).toEqual({ id: '1' });
        expect(received[0]?.metadata).toMatchObject({ correlationId: 'c', routing });
    });

    it('should publish through any IMessageBus', async () => {
        const messageBus = new FakeMessageBus();
        const caller = new DispatchCaller({ routing, messageBus });

        await caller.call('run', { id: '1' }, {});

        expect(messageBus.published.map((message) => message.type)).toEqual(['run']);
    });

    it('should report a command no consumer accepted to onUndelivered', async () => {
        const undelivered: Message[] = [];
        const messageBus = new FakeMessageBus();
        const caller = new DispatchCaller({
            routing,
            messageBus,
            hooks: { onUndelivered: (message) => { undelivered.push(message); } },
        });

        await caller.call('run', { id: '1' }, {});
        expect(undelivered).toEqual([]);

        messageBus.accepted = false;
        await caller.call('run', { id: '2' }, {});
        expect(undelivered).toEqual([messageBus.published[1]]);
        expect(undelivered[0]?.data).toEqual({ id: '2' });
    });

    it('should resolve when onUndelivered throws', async () => {
        const messageBus = new FakeMessageBus();
        messageBus.accepted = false;
        const caller = new DispatchCaller({
            routing,
            messageBus,
            hooks: { onUndelivered: () => { throw new Error('hook'); } },
        });

        await expect(caller.call('run', {}, {})).resolves.toBeUndefined();
    });
});
