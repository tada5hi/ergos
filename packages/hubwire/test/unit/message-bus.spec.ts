import { describe, expect, it } from 'vitest';
import {
    MessageBus,
    buildMessage,
    isMessage,
    serializeMessage,
} from '../../src';
import type {
    IMessageBusConsumer,
    IMessageBusDriver,
    Message,
    MessageHandler,
    MessageRouting,
} from '../../src';

const routing: MessageRouting = { type: 'work', key: 'jobs' };

/**
 * Records publishes; deliver() runs the handler the bus registered, as a driver would.
 */
class CaptureDriver implements IMessageBusDriver {
    published: [MessageRouting, Message][] = [];

    handler: MessageHandler | undefined;

    closed = false;

    async publish(to: MessageRouting, message: Message): Promise<void> {
        this.published.push([to, message]);
    }

    async consume(_routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        this.handler = handler;
        return { cancel: async () => {} };
    }

    async close(): Promise<void> {
        this.closed = true;
    }

    async deliver(message: Message): Promise<void> {
        await this.handler?.(message);
    }
}

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

    it('should prefer a specific handler over "*"', async () => {
        const driver = new CaptureDriver();
        const bus = new MessageBus({ driver });
        const seen: string[] = [];
        await bus.consume(routing, {
            run: (message: Message) => { seen.push(`run:${message.type}`); },
            '*': (message) => { seen.push(`any:${message.type}`); },
        });

        await driver.deliver(buildMessage({ type: 'run', metadata: { routing } }));
        await driver.deliver(buildMessage({ type: 'other', metadata: { routing } }));
        await driver.deliver(buildMessage({ type: 'toString', metadata: { routing } }));

        expect(seen).toEqual(['run:run', 'any:other', 'any:toString']);
    });

    it('should hand publish and close to the driver', async () => {
        const driver = new CaptureDriver();
        const bus = new MessageBus({ driver });
        const message = buildMessage({ type: 'run', metadata: { routing } });

        await bus.publish(message);
        await bus.close();

        expect(driver.published).toEqual([[routing, message]]);
        expect(driver.closed).toBe(true);
    });

    it('should rethrow a failing handler to the driver after reporting it to onError', async () => {
        const errors: unknown[][] = [];
        const failure = new Error('x');
        const driver = new CaptureDriver();
        const bus = new MessageBus({
            driver,
            hooks: { onError: (...args) => { errors.push(args); } },
        });
        await bus.consumeAny(routing, () => { throw failure; });
        const message = buildMessage({ type: 'run', metadata: { routing } });

        await expect(driver.deliver(message)).rejects.toThrow('x');
        expect(errors).toEqual([[failure, message, routing]]);
    });

    it('should report publish, consume and unhandled messages to their hooks', async () => {
        const calls: [string, Message, MessageRouting?][] = [];
        const driver = new CaptureDriver();
        const bus = new MessageBus({
            driver,
            hooks: {
                onPublish: (message) => { calls.push(['publish', message]); },
                onConsume: (message, from) => { calls.push(['consume', message, from]); },
                onUnhandled: (message, from) => { calls.push(['unhandled', message, from]); },
            },
        });
        await bus.consume(routing, { run: () => {} });

        const run = buildMessage({ type: 'run', metadata: { routing } });
        const other = buildMessage({ type: 'other', metadata: { routing } });
        await bus.publish(run);
        await driver.deliver(run);
        await expect(driver.deliver(other)).resolves.toBeUndefined();

        expect(calls).toEqual([
            ['publish', run],
            ['consume', run, routing],
            ['consume', other, routing],
            ['unhandled', other, routing],
        ]);
    });

    it('should settle an expired message without a handler, reporting it to onExpired', async () => {
        const calls: [string, Message, MessageRouting][] = [];
        const driver = new CaptureDriver();
        const bus = new MessageBus({
            driver,
            hooks: {
                onExpired: (message, from) => { calls.push(['expired', message, from]); },
                onError: (_error, message, from) => { calls.push(['error', message, from]); },
                onUnhandled: (message, from) => { calls.push(['unhandled', message, from]); },
            },
        });
        const handled: string[] = [];
        await bus.consumeAny(routing, (message) => { handled.push(message.id); });

        const expired = buildMessage({ type: 'run', metadata: { routing, expiresAt: Date.now() - 1 } });
        const fresh = buildMessage({ type: 'run', metadata: { routing, expiresAt: Date.now() + 60_000 } });
        await expect(driver.deliver(expired)).resolves.toBeUndefined();
        await driver.deliver(fresh);

        expect(handled).toEqual([fresh.id]);
        expect(calls).toEqual([['expired', expired, routing]]);
    });

    it('should keep every outcome when a hook throws or rejects', async () => {
        const fail = () => { throw new Error('hook'); };
        const driver = new CaptureDriver();
        const bus = new MessageBus({
            driver,
            hooks: {
                onPublish: fail,
                onConsume: () => Promise.reject(new Error('hook')),
                onUnhandled: fail,
                onError: fail,
                onExpired: fail,
            },
        });
        const handled: string[] = [];
        await bus.consume(routing, {
            run: (message) => { handled.push(message.type); },
            boom: () => { throw new Error('handler'); },
        });

        // published despite onPublish
        await expect(bus.publish(buildMessage({ type: 'run', metadata: { routing } }))).resolves.toBeUndefined();
        expect(driver.published).toHaveLength(1);
        // handled and acked despite onConsume
        await expect(driver.deliver(buildMessage({ type: 'run', metadata: { routing } }))).resolves.toBeUndefined();
        expect(handled).toEqual(['run']);
        // still acked (not turned into a retry) despite onUnhandled
        await expect(driver.deliver(buildMessage({ type: 'nope', metadata: { routing } }))).resolves.toBeUndefined();
        // the handler's own error, not the hook's
        await expect(driver.deliver(buildMessage({ type: 'boom', metadata: { routing } }))).rejects.toThrow('handler');
        // still acked, without a handler, despite onExpired
        await expect(driver.deliver(buildMessage({ type: 'run', metadata: { routing, expiresAt: 0 } }))).resolves.toBeUndefined();
        expect(handled).toEqual(['run']);
    });
});
