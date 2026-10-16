import { describe, expect, it } from 'vitest';
import {
    MemoryMessageBusDriver,
    MessageBus,
    buildMessage,
    isMessage,
    serializeMessage,
} from '../../src';
import type { Message, MessageRouting } from '../../src';
import { FakeLogger } from './fakes/logger';

const routing: MessageRouting = { type: 'work', key: 'jobs' };

describe('src/message-bus', () => {
    it('should build a message with defaults', () => {
        const message = buildMessage({ type: 'run', metadata: { routing } });

        expect(message.id).toBeTypeOf('string');
        expect(message.data).toEqual({});
        expect(message.metadata.timestamp).toBeTypeOf('number');
        expect(message.metadata.routing).toEqual(routing);
        expect(isMessage(message)).toBe(true);
    });

    it('should keep explicit id, data and timestamp', () => {
        const message = buildMessage({
            id: 'a',
            type: 'run',
            data: { x: 1 },
            metadata: { routing, timestamp: 5 },
        });

        expect(message).toEqual({
            id: 'a',
            type: 'run',
            data: { x: 1 },
            metadata: { routing, timestamp: 5 },
        });
    });

    it('should default a timestamp passed as undefined', () => {
        const message = buildMessage({
            type: 'run',
            metadata: { timestamp: undefined, routing: { type: 'work', key: 'q' } },
        });
        expect(message.metadata.timestamp).toBeTypeOf('number');
    });

    it('should reject malformed messages', () => {
        expect(isMessage(null)).toBe(false);
        expect(isMessage({
            id: 'a', 
            type: 'run', 
            data: {}, 
        })).toBe(false);
        expect(isMessage({
            id: 1, 
            type: 'run', 
            data: {}, 
            metadata: {},
        })).toBe(false);
        expect(isMessage({
            id: 'a', 
            type: 'run', 
            data: 'x', 
            metadata: {},
        })).toBe(false);
    });

    it('should serialize an Error with name, message and code', () => {
        const error = Object.assign(new Error('boom'), { code: 'E_X' });
        const message = buildMessage({
            id: 'a',
            type: 'failed',
            data: { error, plain: new TypeError('t') },
            metadata: { routing, timestamp: 1 },
        });

        expect(JSON.parse(serializeMessage(message)).data).toEqual({
            error: {
                name: 'Error', 
                message: 'boom', 
                code: 'E_X', 
            },
            plain: { name: 'TypeError', message: 't' },
        });
    });

    it('should resolve false when publishing to a routing nobody consumes', async () => {
        const bus = new MessageBus({ driver: new MemoryMessageBusDriver() });
        await expect(bus.publish(buildMessage({ type: 'run', metadata: { routing } })))
            .resolves.toBe(false);
    });

    it('should prefer a specific handler over "*"', async () => {
        const bus = new MessageBus({ driver: new MemoryMessageBusDriver() });
        const seen: string[] = [];
        await bus.consume(routing, {
            run: (message: Message) => { seen.push(`run:${message.type}`); },
            '*': (message) => { seen.push(`any:${message.type}`); },
        });

        await bus.publish(buildMessage({ type: 'run', metadata: { routing } }));
        await bus.publish(buildMessage({ type: 'other', metadata: { routing } }));

        await bus.publish(buildMessage({ type: 'toString', metadata: { routing } }));

        expect(seen).toEqual(['run:run', 'any:other', 'any:toString']);
    });

    it('should ack a message no handler accepts', async () => {
        const bus = new MessageBus({ driver: new MemoryMessageBusDriver() });
        await bus.consume(routing, {});
        await expect(bus.publish(buildMessage({ type: 'run', metadata: { routing } })))
            .resolves.toBe(true);
    });

    it('should log and rethrow a failing handler', async () => {
        const logger = new FakeLogger();
        const bus = new MessageBus({ driver: new MemoryMessageBusDriver(), logger });
        const consumer = await bus.consumeAny(routing, () => { throw new Error('x'); });

        await expect(bus.publish(buildMessage({ type: 'run', metadata: { routing } })))
            .rejects.toThrow('x');
        expect(logger.messages('error')).toHaveLength(1);

        await consumer.cancel();
        await expect(bus.publish(buildMessage({ type: 'run', metadata: { routing } })))
            .resolves.toBe(false);
    });

    it('should not log a publish when logging is off', async () => {
        const logger = new FakeLogger();
        const bus = new MessageBus({ driver: new MemoryMessageBusDriver(), logger });
        await bus.publish(buildMessage({ type: 'run', metadata: { routing } }), { logging: false });
        expect(logger.calls).toEqual([]);
    });
});
