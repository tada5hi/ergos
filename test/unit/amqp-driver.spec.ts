import type { ConsumeMessage } from 'amqp-extension';
import { ATTEMPT_HEADER, retryMessage } from 'amqp-extension';
import { describe, expect, it } from 'vitest';
import { AmqpMessageBusDriver } from '../../src/amqp';
import { buildMessageBusPayload } from '../../src';
import type { MessageBusPayload, MessageBusRouting } from '../../src';
import { FakeAmqpClient } from './fakes/amqp-client';
import { FakeLogger } from './fakes/logger';
import { hubWireFixture } from './fixtures/hub-wire';

const shapes = {
    work: { type: 'work', key: 'tasks' },
    workOrdered: {
        type: 'work', 
        key: 'replies', 
        ordered: true, 
    },
    pubSubNamespace: {
        type: 'pubSub', 
        key: 'events', 
        namespace: 'custom', 
    },
    pubSub: { type: 'pubSub', key: 'events' },
} satisfies Record<string, MessageBusRouting>;

const retry = { maxAttempts: 5, delay: 1000 };

const message = (routing: MessageBusRouting) => buildMessageBusPayload({
    id: 'msg-1',
    type: 'execute',
    data: { id: 'a' },
    metadata: { routing, timestamp: 1_700_000_000_000 },
});

function createDriver(client = new FakeAmqpClient(), logger?: FakeLogger) {
    return new AmqpMessageBusDriver({
        client, 
        logger, 
        defaultTopicExchange: 'FLAME', 
    });
}

function toConsumeMessage(body: string, headers?: Record<string, unknown>): ConsumeMessage {
    return {
        content: Buffer.from(body),
        fields: {
            deliveryTag: 1, 
            redelivered: false, 
            exchange: '', 
            routingKey: 'tasks', 
            consumerTag: 'c', 
        },
        properties: {
            contentType: undefined,
            contentEncoding: undefined,
            headers,
            deliveryMode: 2,
            priority: undefined,
            correlationId: undefined,
            replyTo: undefined,
            expiration: undefined,
            messageId: 'msg-1',
            timestamp: undefined,
            type: 'execute',
            userId: undefined,
            appId: undefined,
            clusterId: undefined,
        },
    };
}

describe('src/amqp', () => {
    describe('wire compatibility with hub', () => {
        it.each(Object.keys(shapes) as (keyof typeof shapes)[])('should publish %s like hub', async (name) => {
            const client = new FakeAmqpClient();
            const routing = shapes[name];

            await expect(createDriver(client).publish(routing, message(routing))).resolves.toBe(true);

            const [expected] = hubWireFixture[name];
            const [actual] = client.publishes;
            expect({ op: 'publish', ...actual }).toEqual(expected);
        });

        it.each(Object.keys(shapes) as (keyof typeof shapes)[])('should consume %s like hub', async (name) => {
            const client = new FakeAmqpClient();
            const routing = shapes[name];

            await createDriver(client).consume(routing, () => {});

            const [, expected] = hubWireFixture[name];
            const [actual] = client.consumes;
            expect(actual?.exchange).toEqual(expected.exchange);
            expect(actual?.key).toEqual(expected.key);

            // hub retried in the driver; the retry now lives in amqp-extension (WORK only)
            const isWork = routing.type === 'work';
            const ordered = 'ordered' in routing && routing.ordered;
            expect(actual?.options).toEqual({
                ...expected.options,
                ...(isWork ? { retry } : {}),
                ...(ordered ? { ordered: true } : {}),
            });
        });

        it('should move only the retry counter from the body into the x-attempt header', async () => {
            const client = new FakeAmqpClient();
            await createDriver(client).publish(shapes.work, message(shapes.work));
            const [published] = client.publishes;
            if (!published) throw new Error('nothing published');

            const republished: { content: Buffer, headers: unknown }[] = [];
            await retryMessage(toConsumeMessage(published.body), async (content, options) => {
                republished.push({ content, headers: options.headers });
            }, { delay: 0 });

            const [hubRetry] = hubWireFixture.workRetry;
            const hubBody: MessageBusPayload & { metadata: { attempt?: number } } = JSON.parse(hubRetry.body);
            expect(hubBody.metadata.attempt).toBe(2);
            delete hubBody.metadata.attempt;

            expect(JSON.parse(republished[0]?.content.toString() ?? '')).toEqual(hubBody);
            expect(republished[0]?.headers).toEqual({ [ATTEMPT_HEADER]: 2 });
        });
    });

    it('should pass custom retry and prefetch options', async () => {
        const client = new FakeAmqpClient();
        const driver = new AmqpMessageBusDriver({
            client,
            defaultTopicExchange: 'FLAME',
            maxAttempts: 3,
            retryDelay: 10,
            prefetchCount: 4,
        });

        await driver.consume(shapes.work, () => {});

        expect(client.consumes[0]?.options).toMatchObject({ prefetchCount: 4, retry: { maxAttempts: 3, delay: 10 } });
    });

    it('should hand a parsed payload to the handler', async () => {
        const client = new FakeAmqpClient();
        const seen: MessageBusPayload[] = [];
        await createDriver(client).consume(shapes.work, (payload) => { seen.push(payload); });

        await client.consumes[0]?.handler({ content: Buffer.from(JSON.stringify(message(shapes.work))) });

        expect(seen).toEqual([message(shapes.work)]);
    });

    it('should let a handler error reach amqp-extension (which retries or nacks)', async () => {
        const client = new FakeAmqpClient();
        await createDriver(client).consume(shapes.work, () => { throw new Error('boom'); });

        await expect(client.consumes[0]?.handler({ content: Buffer.from(JSON.stringify(message(shapes.work))) }))
            .rejects.toThrow('boom');
    });

    it('should drop (ack) an unparsable or malformed message with a warning', async () => {
        const client = new FakeAmqpClient();
        const logger = new FakeLogger();
        const seen: MessageBusPayload[] = [];
        await createDriver(client, logger).consume(shapes.work, (payload) => { seen.push(payload); });

        await client.consumes[0]?.handler({ content: Buffer.from('{nope') });
        await client.consumes[0]?.handler({ content: Buffer.from(JSON.stringify({ id: 1 })) });

        expect(seen).toEqual([]);
        expect(logger.messages('warn')).toHaveLength(2);
    });

    it('should serialize errors in the body', async () => {
        const client = new FakeAmqpClient();
        const error = Object.assign(new Error('registry unavailable'), { code: 'registryNotFound' });

        await createDriver(client).publish(shapes.work, buildMessageBusPayload({
            type: 'executionFailed',
            data: { error },
            metadata: { routing: shapes.work },
        }));

        expect(JSON.parse(client.publishes[0]?.body ?? '').data.error).toEqual({
            name: 'Error',
            message: 'registry unavailable',
            code: 'registryNotFound',
        });
    });

    it('should honour an explicit persistent flag', async () => {
        const client = new FakeAmqpClient();
        const payload = message(shapes.work);
        payload.metadata.persistent = false;

        await createDriver(client).publish(shapes.work, payload);

        expect(client.publishes[0]?.options.persistent).toBe(false);
    });

    it('should return a consumer that cancels the amqp-extension consumer', async () => {
        const client = new FakeAmqpClient();
        const consumer = await createDriver(client).consume(shapes.pubSub, () => {});

        await consumer.cancel();

        expect(client.consumes[0]?.cancelled).toBe(true);
    });

    it('should close the client', async () => {
        const client = new FakeAmqpClient();
        const driver = createDriver(client);
        await driver.close();

        expect(client.closed).toBe(1);
        await expect(driver.publish(shapes.work, message(shapes.work))).rejects.toThrow('closed');
    });

    it('should create a client lazily from a connection string', async () => {
        const driver = new AmqpMessageBusDriver({ connectionString: 'amqp://unused', defaultTopicExchange: 'FLAME' });

        // nothing connected yet, so closing is a no-op
        await expect(driver.close()).resolves.toBeUndefined();
    });
});
