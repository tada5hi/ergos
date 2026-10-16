import { describe, expect, it } from 'vitest';
import {
    MemoryMessageBusDriver,
    MessageBus,
    buildMessage,
    isMessage,
    serializeMessage,
} from '../../src';
import type { Message, MessageRouting } from '../../src';

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

    it('should rethrow a failing handler after reporting it to onError', async () => {
        const errors: unknown[][] = [];
        const failure = new Error('x');
        const bus = new MessageBus({
            driver: new MemoryMessageBusDriver(),
            hooks: { onError: (...args) => { errors.push(args); } },
        });
        const consumer = await bus.consumeAny(routing, () => { throw failure; });
        const message = buildMessage({ type: 'run', metadata: { routing } });

        await expect(bus.publish(message)).rejects.toThrow('x');
        expect(errors).toEqual([[failure, message, routing]]);

        await consumer.cancel();
        await expect(bus.publish(buildMessage({ type: 'run', metadata: { routing } })))
            .resolves.toBe(false);
    });

    it('should report publish, consume and unhandled messages to their hooks', async () => {
        const calls: [string, Message, MessageRouting?][] = [];
        const bus = new MessageBus({
            driver: new MemoryMessageBusDriver(),
            hooks: {
                onPublish: (message) => { calls.push(['publish', message]); },
                onConsume: (message, consumeRouting) => { calls.push(['consume', message, consumeRouting]); },
                onUnhandled: (message, consumeRouting) => { calls.push(['unhandled', message, consumeRouting]); },
            },
        });
        await bus.consume(routing, { run: () => {} });

        const run = buildMessage({ type: 'run', metadata: { routing } });
        const other = buildMessage({ type: 'other', metadata: { routing } });
        await bus.publish(run);
        await bus.publish(other);

        expect(calls).toEqual([
            ['publish', run],
            ['consume', run, routing],
            ['publish', other],
            ['consume', other, routing],
            ['unhandled', other, routing],
        ]);
    });

    it('should keep every outcome when a hook throws or rejects', async () => {
        const fail = () => { throw new Error('hook'); };
        const bus = new MessageBus({
            driver: new MemoryMessageBusDriver(),
            hooks: {
                onPublish: fail,
                onConsume: () => Promise.reject(new Error('hook')),
                onUnhandled: fail,
                onError: fail,
            },
        });
        const handled: string[] = [];
        await bus.consume(routing, {
            run: (message) => { handled.push(message.type); },
            boom: () => { throw new Error('handler'); },
        });

        // delivered and acked despite onPublish / onConsume
        await expect(bus.publish(buildMessage({ type: 'run', metadata: { routing } }))).resolves.toBe(true);
        expect(handled).toEqual(['run']);
        // still acked (not turned into a retry) despite onUnhandled
        await expect(bus.publish(buildMessage({ type: 'nope', metadata: { routing } }))).resolves.toBe(true);
        // the handler's own error, not the hook's
        await expect(bus.publish(buildMessage({ type: 'boom', metadata: { routing } }))).rejects.toThrow('handler');
    });
});
