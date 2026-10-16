import { describe, expect, it } from 'vitest';
import {
    MemoryMessageBusDriver,
    MessageBus,
    buildMessageBusPayload,
    isMessageBusPayload,
    serializeMessageBusPayload,
} from '../../src';
import type { MessageBusPayload, MessageBusRouting } from '../../src';
import { FakeLogger } from './fakes/logger';

const routing: MessageBusRouting = { type: 'work', key: 'jobs' };

describe('src/message-bus', () => {
    it('should build a payload with defaults', () => {
        const payload = buildMessageBusPayload({ type: 'run', metadata: { routing } });

        expect(payload.id).toBeTypeOf('string');
        expect(payload.data).toEqual({});
        expect(payload.metadata.timestamp).toBeTypeOf('number');
        expect(payload.metadata.routing).toEqual(routing);
        expect(isMessageBusPayload(payload)).toBe(true);
    });

    it('should keep explicit id, data and timestamp', () => {
        const payload = buildMessageBusPayload({
            id: 'a',
            type: 'run',
            data: { x: 1 },
            metadata: { routing, timestamp: 5 },
        });

        expect(payload).toEqual({
            id: 'a',
            type: 'run',
            data: { x: 1 },
            metadata: { routing, timestamp: 5 },
        });
    });

    it('should default a timestamp passed as undefined', () => {
        const payload = buildMessageBusPayload({
            type: 'run',
            metadata: { timestamp: undefined, routing: { type: 'work', key: 'q' } },
        });
        expect(payload.metadata.timestamp).toBeTypeOf('number');
    });

    it('should reject malformed payloads', () => {
        expect(isMessageBusPayload(null)).toBe(false);
        expect(isMessageBusPayload({
            id: 'a', 
            type: 'run', 
            data: {}, 
        })).toBe(false);
        expect(isMessageBusPayload({
            id: 1, 
            type: 'run', 
            data: {}, 
            metadata: {},
        })).toBe(false);
        expect(isMessageBusPayload({
            id: 'a', 
            type: 'run', 
            data: 'x', 
            metadata: {},
        })).toBe(false);
    });

    it('should serialize an Error with name, message and code', () => {
        const error = Object.assign(new Error('boom'), { code: 'E_X' });
        const payload = buildMessageBusPayload({
            id: 'a',
            type: 'failed',
            data: { error, plain: new TypeError('t') },
            metadata: { routing, timestamp: 1 },
        });

        expect(JSON.parse(serializeMessageBusPayload(payload)).data).toEqual({
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
        await expect(bus.publish(buildMessageBusPayload({ type: 'run', metadata: { routing } })))
            .resolves.toBe(false);
    });

    it('should prefer a specific handler over $any', async () => {
        const bus = new MessageBus({ driver: new MemoryMessageBusDriver() });
        const seen: string[] = [];
        await bus.consume(routing, {
            run: (payload: MessageBusPayload) => { seen.push(`run:${payload.type}`); },
            $any: (payload) => { seen.push(`any:${payload.type}`); },
        });

        await bus.publish(buildMessageBusPayload({ type: 'run', metadata: { routing } }));
        await bus.publish(buildMessageBusPayload({ type: 'other', metadata: { routing } }));

        await bus.publish(buildMessageBusPayload({ type: 'toString', metadata: { routing } }));

        expect(seen).toEqual(['run:run', 'any:other', 'any:toString']);
    });

    it('should ack a message no handler accepts', async () => {
        const bus = new MessageBus({ driver: new MemoryMessageBusDriver() });
        await bus.consume(routing, {});
        await expect(bus.publish(buildMessageBusPayload({ type: 'run', metadata: { routing } })))
            .resolves.toBe(true);
    });

    it('should log and rethrow a failing handler', async () => {
        const logger = new FakeLogger();
        const bus = new MessageBus({ driver: new MemoryMessageBusDriver(), logger });
        const consumer = await bus.consumeAny(routing, () => { throw new Error('x'); });

        await expect(bus.publish(buildMessageBusPayload({ type: 'run', metadata: { routing } })))
            .rejects.toThrow('x');
        expect(logger.messages('error')).toHaveLength(1);

        await consumer.cancel();
        await expect(bus.publish(buildMessageBusPayload({ type: 'run', metadata: { routing } })))
            .resolves.toBe(false);
    });

    it('should not log a publish when logging is off', async () => {
        const logger = new FakeLogger();
        const bus = new MessageBus({ driver: new MemoryMessageBusDriver(), logger });
        await bus.publish(buildMessageBusPayload({ type: 'run', metadata: { routing } }), { logging: false });
        expect(logger.calls).toEqual([]);
    });
});
