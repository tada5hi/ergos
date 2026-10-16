import { ClientError, resolveAttempt } from 'amqp-extension';
import type { ConsumeMessage } from 'amqp-extension';
import { describe, expect, it } from 'vitest';
import { AmqpMessageBusDriver } from '../../src';
import type { AmqpMalformedMessage, AmqpMessageBusDriverHooks } from '../../src';
import { setImmediate as tick } from 'node:timers/promises';
import {
    Component,
    MessageBus,
    RemoteWorker,
    buildMessage,
} from 'busline';
import type { Message, MessageRouting } from 'busline';
import { defineDriverConformance } from '@busline/test';
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
    defineDriverConformance({ describe, it }, () => createDriver(FakeAmqpClient.loopback()));

    describe('wire compatibility with hub', () => {
        it.each(Object.keys(shapes) as (keyof typeof shapes)[])('should publish %s like hub', async (name) => {
            const client = new FakeAmqpClient();
            const routing = shapes[name];

            await expect(createDriver(client).publish(routing, message(routing))).resolves.toBeUndefined();

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

    it('should consume a PUB_SUB queue through a named, retried queue and publish to it like plain PUB_SUB', async () => {
        const client = new FakeAmqpClient();
        const driver = new AmqpMessageBusDriver({
            client,
            defaultTopicExchange: 'FLAME',
            maxAttempts: 3,
        });
        const seen: Message[] = [];
        const subscription: MessageRouting = { ...shapes.pubSubNamespace, queue: 'hub-events' };

        await driver.consume(subscription, (received) => { seen.push(received); });
        await driver.publish(subscription, message(subscription));

        const [consumed] = client.consumes;
        expect(consumed?.exchange).toEqual({ type: 'topic', name: 'custom' });
        expect(consumed?.key).toBe('events');
        const { onError, ...options } = consumed?.options ?? {};
        expect(options).toEqual({
            prefetchCount: 1,
            requeueOnFailure: true,
            queue: 'hub-events',
            retry: { maxAttempts: 3, delay: 1000 },
        });
        expect(typeof onError).toBe('function');
        // the publisher declares no queue, so it never conflicts with the consumer's
        expect(client.publishes[0]?.options).not.toHaveProperty('queue');

        const content = Buffer.from(JSON.stringify(message(subscription)));
        await consumed?.handler({ content, properties: { headers: { 'x-attempt': 2 } } });
        expect(seen[0]?.metadata.delivery).toEqual({ attempt: 2, maxAttempts: 3 });
    });

    it('should map a namespaced WORK routing onto the durable queue `namespace/key` of the default exchange', async () => {
        const client = new FakeAmqpClient();
        const routing: MessageRouting = { ...shapes.work, namespace: 'custom' };

        await createDriver(client).consume(routing, () => {});
        // the publisher declares the queue too, so a message published before any consumer is kept
        await createDriver(client).publish(routing, message(routing));

        const [consumed] = client.consumes;
        expect(consumed?.exchange).toEqual({ type: 'direct', name: '' });
        expect(consumed?.key).toBe('custom/tasks');
        const { onError, ...options } = consumed?.options ?? {};
        expect(options).toEqual({
            prefetchCount: 1,
            requeueOnFailure: true,
            retry,
        });
        expect(typeof onError).toBe('function');

        const [published] = client.publishes;
        expect(published?.exchange).toEqual({ type: 'direct', name: '' });
        expect(published?.key).toBe('custom/tasks');
        expect(published?.options).toEqual({
            type: 'execute',
            messageId: 'msg-1',
            persistent: true,
        });
    });

    it('should declare an ordered namespaced WORK queue single-active on publish and consume', async () => {
        const client = new FakeAmqpClient();
        const routing: MessageRouting = { ...shapes.workOrdered, namespace: 'custom' };

        await createDriver(client).consume(routing, () => {});
        await createDriver(client).publish(routing, message(routing));

        expect(client.consumes[0]?.key).toBe('custom/replies');
        expect(client.consumes[0]?.options.singleActiveConsumer).toBe(true);
        expect(client.publishes[0]?.key).toBe('custom/replies');
        expect(client.publishes[0]?.options.singleActiveConsumer).toBe(true);
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

    it('should hand a WORK handler its delivery attempt from the x-attempt header and maxAttempts', async () => {
        const client = new FakeAmqpClient();
        const seen: Message[] = [];
        await new AmqpMessageBusDriver({
            client,
            defaultTopicExchange: 'FLAME',
            maxAttempts: 3,
        }).consume(shapes.work, (received) => { seen.push(received); });

        const content = Buffer.from(JSON.stringify(message(shapes.work)));
        await client.consumes[0]?.handler({ content, properties: { headers: { 'x-attempt': 3 } } });
        await client.consumes[0]?.handler({ content, properties: {} });

        expect(seen.map((received) => received.metadata.delivery)).toEqual([
            { attempt: 3, maxAttempts: 3 },
            { attempt: 1, maxAttempts: 3 },
        ]);
    });

    it('should override delivery info in the body of a message', async () => {
        const client = new FakeAmqpClient();
        const seen: Message[] = [];
        await createDriver(client).consume(shapes.work, (received) => { seen.push(received); });

        const forged = message(shapes.work);
        forged.metadata.delivery = { attempt: 4, maxAttempts: 4 };
        await client.consumes[0]?.handler({ content: Buffer.from(JSON.stringify(forged)), properties: {} });

        expect(seen[0]?.metadata.delivery).toEqual({ attempt: 1, maxAttempts: 5 });
    });

    it('should report attempt 1 of 1 on a PUB_SUB message (not retried)', async () => {
        const client = new FakeAmqpClient();
        const seen: Message[] = [];
        await createDriver(client).consume(shapes.pubSub, (received) => { seen.push(received); });

        await client.consumes[0]?.handler({ content: Buffer.from(JSON.stringify(message(shapes.pubSub))), properties: { headers: { 'x-attempt': 3 } } });

        expect(seen[0]?.metadata.delivery).toEqual({ attempt: 1, maxAttempts: 1 });
    });

    it('should let a handler error reach amqp-extension (which retries or nacks)', async () => {
        const client = new FakeAmqpClient();
        await createDriver(client).consume(shapes.work, () => { throw new Error('boom'); });

        await expect(client.consumes[0]?.handler({ content: Buffer.from(JSON.stringify(message(shapes.work))), properties: {} }))
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
        await client.consumes[0]?.handler({ content: unparsable, properties: {} });
        await client.consumes[0]?.handler({ content: shapeless, properties: {} });

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

        await expect(client.consumes[0]?.handler({ content: Buffer.from('{nope'), properties: {} })).resolves.toBeUndefined();
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

    it('should make a routing persistent, a message flag still winning', async () => {
        const client = new FakeAmqpClient();
        const routing: MessageRouting = { ...shapes.pubSub, persistent: true };
        const opted = message(routing);
        opted.metadata.persistent = false;

        await createDriver(client).publish(routing, message(routing));
        await createDriver(client).publish(routing, opted);

        expect(client.publishes.map((item) => item.options.persistent)).toEqual([true, false]);
    });

    it('should publish a RemoteWorker\'s events persistent through a persistent routing', async () => {
        const client = FakeAmqpClient.loopback();
        const messageBus = new MessageBus({ driver: createDriver(client) });
        const component = new Component();
        component.mount('execute', async (data, ctx) => {
            await ctx.handle('executed', data);
        });
        await new RemoteWorker(component, {
            messageBus,
            consume: shapes.work,
            publish: { ...shapes.pubSub, persistent: true },
        }).start();

        const command = message(shapes.work);
        command.metadata.persistent = false;
        await messageBus.publish(command);
        await tick();

        expect(client.publishes.map((item) => [item.key, item.options.persistent])).toEqual([
            ['tasks', false],
            ['events', true],
        ]);
    });

    it('should map expiresAt to the expiration property (remaining ms, never negative)', async () => {
        const client = new FakeAmqpClient();
        const driver = createDriver(client);
        const later = message(shapes.work);
        later.metadata.expiresAt = Date.now() + 60_000;
        const past = message(shapes.work);
        past.metadata.expiresAt = 0;
        const fractional = message(shapes.work);
        fractional.metadata.expiresAt = Date.now() + 1000 / 3;

        await driver.publish(shapes.work, later);
        await driver.publish(shapes.work, past);
        await driver.publish(shapes.work, message(shapes.work));
        await driver.publish(shapes.work, fractional);

        const [first, second, third, fourth] = client.publishes.map((entry) => entry.options.expiration);
        expect(Number(first)).toBeGreaterThan(59_000);
        expect(Number(first)).toBeLessThanOrEqual(60_000);
        expect(first).toBeTypeOf('string');
        expect(second).toBe('0');
        expect(third).toBeUndefined();
        // the broker only takes an integer
        expect(fourth).toMatch(/^\d+$/);
    });

    it('should close the client', async () => {
        const client = new FakeAmqpClient();
        const driver = createDriver(client);
        await driver.publish(shapes.work, message(shapes.work));

        await driver.close();

        expect(client.closed).toBe(1);
    });

    it('should create a client lazily from a connection string', async () => {
        const driver = new AmqpMessageBusDriver({ connectionString: 'amqp://unused', defaultTopicExchange: 'FLAME' });

        // nothing connected yet, so closing is a no-op
        await expect(driver.close()).resolves.toBeUndefined();
    });
});
