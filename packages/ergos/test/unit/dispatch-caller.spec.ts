import { describe, expect, it } from 'vitest';
import { DispatchCaller, MemoryMessageBusDriver, MessageBus } from '../../src';
import type { Message, MessageRouting } from '../../src';
import { FakeLogger } from './fakes/logger';

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

    it('should log and resolve without a message bus', async () => {
        const logger = new FakeLogger();
        const caller = new DispatchCaller({ routing, logger });

        await expect(caller.call('run', {}, {})).resolves.toBeUndefined();
        expect(logger.messages('warn')).toHaveLength(1);
        expect(logger.messages('warn')[0]).toContain('run');
    });

    it('should warn when no consumer accepted the command', async () => {
        const logger = new FakeLogger();
        const messageBus = new MessageBus({ driver: new MemoryMessageBusDriver() });
        const caller = new DispatchCaller({
            routing,
            messageBus,
            logger,
            logging: false,
        });

        await caller.call('run', {}, {});
        expect(logger.messages('warn')).toHaveLength(1);
    });
});
