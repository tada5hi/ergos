import { ClientError, resolveAttempt } from 'amqp-extension';
import type { ConsumeMessage } from 'amqp-extension';
import { describe, expect, it } from 'vitest';
import { AmqpMessageBusDriver } from '../../src';
import type { AmqpMalformedMessage, AmqpMessageBusDriverHooks } from '../../src';
import { buildMessage } from 'synergos';
import type { Message, MessageRouting } from 'synergos';
import { FakeAmqpClient } from './fakes/amqp-client';
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
} satisfies Record<string, MessageRouting>;

const retry = { maxAttempts: 5, delay: 1000 };

const message = (routing: MessageRouting) => buildMessage({
    id: 'msg-1',
    type: 'execute',
    data: { id: 'a' },
    metadata: { routing, timestamp: 1_700_000_000_000 },
});

function createDriver(client = new FakeAmqpClient(), hooks?: AmqpMessageBusDriverHooks) {
    return new AmqpMessageBusDriver({
        client,
        hooks,
        defaultTopicExchange: 'FLAME',
    });
}

function toConsumeMessage(
    type: string,
    messageId: string,
    content: Buffer = Buffer.from(JSON.stringify(message(shapes.work))),
    attempt = 2,
): ConsumeMessage {
    return {
        content,
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
            headers: { 'x-attempt': attempt },
            deliveryMode: 2,
            priority: undefined,
            correlationId: undefined,
            replyTo: undefined,
            expiration: undefined,
            messageId,
            timestamp: undefined,
            type,
            userId: undefined,
            appId: undefined,
            clusterId: undefined,
        },
    };
}

describe('src/module', () => {
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
            const { onError, ...options } = actual?.options ?? {};
            expect(options).toEqual({
                ...expected.options,
                ...(isWork ? { retry } : {}),
            });
            // reports retries and drops to the hooks (hub's driver logged them)
            expect(typeof onError).toBe(isWork ? 'function' : 'undefined');
        });

        // amqp-extension re-publishes the content verbatim with the attempt in its
        // x-attempt header (pinned by its own retry spec), so only the body is pinned here.
        it('should move only the retry counter out of the body', async () => {
            const client = new FakeAmqpClient();
            await createDriver(client).publish(shapes.work, message(shapes.work));
            const [published] = client.publishes;
            if (!published) throw new Error('nothing published');

            const [hubRetry] = hubWireFixture.workRetry;
            const hubBody: Message & { metadata: { attempt?: number } } = JSON.parse(hubRetry.body);
            expect(hubBody.metadata.attempt).toBe(2);
            delete hubBody.metadata.attempt;

            expect(JSON.parse(published.body)).toEqual(hubBody);
        });

        it('should count a message retried by hub (attempt in the body) as attempt 1, never dropping it early', () => {
            expect(resolveAttempt({ headers: undefined })).toBe(1);
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

    it('should report a retried WORK message to onRetry and a dropped one to onDrop', async () => {
        const client = new FakeAmqpClient();
        const retried: unknown[] = [];
        const dropped: unknown[] = [];
        await createDriver(client, {
            onRetry: (failure) => { retried.push(failure); },
            onDrop: (failure) => { dropped.push(failure); },
        }).consume(shapes.work, () => {});
        const { onError } = client.consumes[0]?.options ?? {};
        if (!onError) throw new Error('no onError');

        const failure = new Error('boom');
        await onError(failure, toConsumeMessage('execute', 'msg-1'));
        await onError(ClientError.attemptsExhausted('execute', failure), toConsumeMessage('execute', 'msg-1', undefined, 5));

        expect(retried).toEqual([{
            message: message(shapes.work),
            routing: shapes.work,
            attempt: 2,
            error: failure,
        }]);
        expect(dropped).toEqual([{
            message: message(shapes.work),
            routing: shapes.work,
            attempt: 5,
            error: failure,
        }]);
    });

    it('should report undecodable content in onError to onMalformed, not onRetry', async () => {
        const client = new FakeAmqpClient();
        const retried: unknown[] = [];
        const malformed: unknown[] = [];
        await createDriver(client, {
            onRetry: (failure) => { retried.push(failure); },
            onMalformed: (delivery) => { malformed.push(delivery); },
        }).consume(shapes.work, () => {});
        const { onError } = client.consumes[0]?.options ?? {};
        if (!onError) throw new Error('no onError');

        await onError(new Error('boom'), toConsumeMessage('execute', 'msg-1', Buffer.from('{}')));

        expect(retried).toEqual([]);
        expect(malformed).toHaveLength(1);
    });

    it('should hand a parsed payload to the handler', async () => {
        const client = new FakeAmqpClient();
        const seen: Message[] = [];
        await createDriver(client).consume(shapes.work, (received) => { seen.push(received); });

        await client.consumes[0]?.handler({ content: Buffer.from(JSON.stringify(message(shapes.work))) });

        expect(seen).toEqual([message(shapes.work)]);
    });

    it('should let a handler error reach amqp-extension (which retries or nacks)', async () => {
        const client = new FakeAmqpClient();
        await createDriver(client).consume(shapes.work, () => { throw new Error('boom'); });

        await expect(client.consumes[0]?.handler({ content: Buffer.from(JSON.stringify(message(shapes.work))) }))
            .rejects.toThrow('boom');
    });

    it('should drop (ack) an unparsable or malformed message, reporting it to onMalformed', async () => {
        const client = new FakeAmqpClient();
        const malformed: AmqpMalformedMessage[] = [];
        const seen: Message[] = [];
        await createDriver(client, { onMalformed: (delivery) => { malformed.push(delivery); } })
            .consume(shapes.work, (received) => { seen.push(received); });

        const unparsable = Buffer.from('{nope');
        const shapeless = Buffer.from(JSON.stringify({ id: 1 }));
        await client.consumes[0]?.handler({ content: unparsable });
        await client.consumes[0]?.handler({ content: shapeless });

        expect(seen).toEqual([]);
        expect(malformed).toHaveLength(2);
        expect(malformed[0]).toMatchObject({ routing: shapes.work, content: unparsable });
        expect(malformed[0]?.error).toBeInstanceOf(SyntaxError);
        expect(malformed[1]).toEqual({ routing: shapes.work, content: shapeless });
    });

    it('should still ack a malformed message when onMalformed throws', async () => {
        const client = new FakeAmqpClient();
        await createDriver(client, { onMalformed: () => { throw new Error('hook'); } })
            .consume(shapes.work, () => {});

        await expect(client.consumes[0]?.handler({ content: Buffer.from('{nope') })).resolves.toBeUndefined();
    });

    it('should serialize errors in the body', async () => {
        const client = new FakeAmqpClient();
        const error = Object.assign(new Error('registry unavailable'), { code: 'registryNotFound' });

        await createDriver(client).publish(shapes.work, buildMessage({
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
        const input = message(shapes.work);
        input.metadata.persistent = false;

        await createDriver(client).publish(shapes.work, input);

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
