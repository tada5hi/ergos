import { describe, expect, it } from 'vitest';
import { RemoteDispatcher } from '../../src';
import type { MessageRouting } from '../../src';
import type { TestEventMap } from './fakes/component';
import { FakeMessageBus } from './fakes/message-bus';

const routing: MessageRouting = { type: 'work', key: 'commands' };

class RejectingMessageBus extends FakeMessageBus {
    override async publish(): Promise<void> {
        throw new Error('publish');
    }
}

describe('src/dispatcher/remote', () => {
    it('should publish the command to its routing', async () => {
        const messageBus = new FakeMessageBus();
        const result = await new RemoteDispatcher<TestEventMap>({ messageBus, routing })
            .dispatch('execute', { id: 'a' });

        expect(messageBus.published).toHaveLength(1);
        const [message] = messageBus.published;
        expect(message?.type).toBe('execute');
        expect(message?.data).toEqual({ id: 'a' });
        expect(message?.metadata.routing).toEqual(routing);
        expect(Object.keys(message?.metadata ?? {})[0]).toBe('timestamp');
        expect(message?.metadata).toMatchObject({ correlationId: result.correlationId });
    });

    it('should keep a given correlationId, persistent and expiresAt', async () => {
        const messageBus = new FakeMessageBus();
        await new RemoteDispatcher<TestEventMap>({ messageBus, routing })
            .dispatch('execute', { id: 'a' }, {
                correlationId: 'c',
                persistent: false,
                expiresAt: 5,
            });

        expect(messageBus.published[0]?.metadata).toMatchObject({
            correlationId: 'c',
            persistent: false,
            expiresAt: 5,
        });
    });

    it('should generate a correlationId for an empty one', async () => {
        const messageBus = new FakeMessageBus();
        const result = await new RemoteDispatcher<TestEventMap>({ messageBus, routing })
            .dispatch('execute', { id: 'a' }, { correlationId: '' });

        expect(result.correlationId).not.toBe('');
        expect(messageBus.published[0]?.metadata).toMatchObject({ correlationId: result.correlationId });
    });

    it('should not inherit transport metadata from a re-dispatched ctx.metadata', async () => {
        const messageBus = new FakeMessageBus();
        const inbound = {
            timestamp: 1,
            delivery: { attempt: 3, maxAttempts: 5 },
            // a body counter from an older hub producer
            attempt: 3,
            persistent: false,
            routing: { type: 'pubSub', key: 'other' } as MessageRouting,
            correlationId: 'c',
        };
        const before = Date.now();
        await new RemoteDispatcher<TestEventMap>({ messageBus, routing })
            .dispatch('execute', { id: 'a' }, inbound);

        const metadata = messageBus.published[0]?.metadata;
        expect(metadata).not.toHaveProperty('delivery');
        expect(metadata).not.toHaveProperty('attempt');
        expect(metadata?.timestamp).toBeGreaterThanOrEqual(before);
        expect(metadata?.routing).toEqual(routing);
        expect(metadata).toMatchObject({ correlationId: 'c', persistent: false });
        expect(Object.keys(metadata ?? {})).toEqual(['timestamp', 'persistent', 'routing', 'correlationId']);
    });

    it('should reject when publish rejects', async () => {
        const dispatcher = new RemoteDispatcher<TestEventMap>({ messageBus: new RejectingMessageBus(), routing });

        await expect(dispatcher.dispatch('execute', { id: 'a' })).rejects.toThrow('publish');
    });
});
