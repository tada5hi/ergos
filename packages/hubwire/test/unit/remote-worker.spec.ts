import { describe, expect, it } from 'vitest';
import {
    Component,
    MemoryMessageBusDriver,
    MessageBus,
    RemoteDispatcher,
    RemoteWorker,
    buildMessage,
} from '../../src';
import type {
    ForwardedEvent,
    Message,
    MessageDelivery,
    MessageRouting,
} from '../../src';
import type { TestEventMap } from './fakes/component';
import { TestComponent } from './fakes/component';
import { FakeMessageBus, drain  } from '@hubwire/test';

const commands: MessageRouting = { type: 'work', key: 'commands' };
const replies: MessageRouting = { type: 'work', key: 'replies' };

function setup() {
    const published: Message[] = [];
    const messageBus = new MessageBus({
        driver: new MemoryMessageBusDriver(),
        hooks: { onPublish: (message) => { published.push(message); } },
    });
    const component = new TestComponent();
    const dispatcher = new RemoteDispatcher<TestEventMap>({ messageBus, routing: commands });

    return {
        messageBus,
        published,
        component,
        dispatcher,
    };
}

async function consumeReplies(messageBus: MessageBus) {
    const received: Message[] = [];
    await messageBus.consumeAny(replies, (message) => { received.push(message); });
    return received;
}

class BlockedStartComponent extends TestComponent {
    gate = Promise.withResolvers<void>();

    override async start() {
        await this.gate.promise;
        await super.start();
    }
}

describe('src/worker/module', () => {
    it('should round-trip a command to an inbox with the same correlationId', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const recorded: unknown[] = [];
        const inbox = new Component<TestEventMap>();
        inbox.mount('executionFinished', (data, ctx) => { recorded.push(data, ctx.metadata.correlationId); });

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            publish: replies,
        }).start();
        await new RemoteWorker(inbox, { messageBus, consume: replies }).start();

        const { correlationId } = await dispatcher.dispatch('execute', { id: 'a' });
        await drain();

        expect(recorded).toEqual([{ id: 'a' }, correlationId]);
    });

    it('should clean the forwarded metadata', async () => {
        const { messageBus, published } = setup();
        const deliveries: unknown[] = [];
        const component = new Component<TestEventMap>();
        component.mount('execute', async (data, ctx) => {
            deliveries.push(ctx.metadata.delivery);
            await ctx.handle('executionFinished', data);
        });

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            publish: replies,
        }).start();

        const before = Date.now();
        // the command's own transport metadata, as a handler's ctx.metadata would carry it
        const inbound = {
            timestamp: 1,
            delivery: { attempt: 5, maxAttempts: 5 } satisfies MessageDelivery,
            // a body counter from an older hub producer
            attempt: 5,
            persistent: true,
            expiresAt: Date.now() + 60_000,
            correlationId: 'c',
            routing: commands,
        };
        await messageBus.publish(buildMessage({
            type: 'execute', 
            data: { id: 'a' }, 
            metadata: inbound, 
        }));
        await drain();

        // the driver's delivery info, never the one in a published body
        expect(deliveries).toEqual([{ attempt: 1, maxAttempts: 1 }]);
        // what went on the wire, not the consuming driver's copy
        expect(published).toHaveLength(2);
        const metadata = published[1]?.metadata;
        expect(metadata).toMatchObject({ correlationId: 'c', routing: replies });
        expect(metadata).not.toHaveProperty('delivery');
        expect(metadata).not.toHaveProperty('attempt');
        expect(metadata).not.toHaveProperty('persistent');
        expect(metadata).not.toHaveProperty('expiresAt');
        expect(metadata?.timestamp).toBeGreaterThanOrEqual(before);
    });

    it('should keep the key order of the forwarded metadata', async () => {
        const {
            messageBus,
            published,
            dispatcher,
        } = setup();
        const component = new Component<TestEventMap>();
        component.mount('execute', (data, ctx) => ctx.handle('executionFinished', data, { step: 2 }));
        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            publish: replies,
        }).start();

        await dispatcher.dispatch('execute', { id: 'a' }, { correlationId: 'c' });
        await drain();

        expect(Object.keys(published[1]?.metadata ?? {})).toEqual(['timestamp', 'correlationId', 'routing', 'step']);
    });

    it('should forward an unknown command to publish', async () => {
        const { messageBus, component } = setup();
        const received = await consumeReplies(messageBus);

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            publish: replies,
        }).start();
        await new RemoteDispatcher({ messageBus, routing: commands }).dispatch('nope', {});
        await drain();

        expect(received.map((message) => message.type)).toEqual(['nope']);
    });

    it('should fail the command when publishing a forwarded event rejects', async () => {
        const messageBus = new FakeMessageBus();
        messageBus.publishError = new Error('publish');
        await new RemoteWorker(new TestComponent(), {
            messageBus,
            consume: commands,
            publish: replies,
        }).start();

        const handler = messageBus.consumed[0]?.handlers['*'];
        const command = buildMessage({
            type: 'execute',
            data: { id: 'a' },
            metadata: { routing: commands },
        });

        // over amqp a rejected handler means a retry, never an ack with the reply lost
        await expect(handler?.(command)).rejects.toThrow('publish');
    });

    it('should report a forwarded event with no publish routing to onUnrouted', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const unrouted: ForwardedEvent[] = [];

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            hooks: { onUnrouted: (event) => { unrouted.push(event); } },
        }).start();
        const { correlationId } = await dispatcher.dispatch('execute', { id: 'a' });
        await drain();

        expect(unrouted).toEqual([{
            key: 'executionFinished',
            data: { id: 'a' },
            metadata: expect.objectContaining({ correlationId }),
        }]);
    });

    it('should settle the command when onUnrouted throws', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            hooks: { onUnrouted: () => { throw new Error('hook'); } },
        }).start();

        await dispatcher.dispatch('execute', { id: 'a' });
        await drain();
        expect(component.handled).toEqual(['a']);
    });

    it('should stop only after the handler in flight finished', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const blocker = Promise.withResolvers<void>();
        component.blocker = blocker.promise;

        const worker = new RemoteWorker(component, { messageBus, consume: commands });
        await worker.start();

        const order: string[] = [];
        await dispatcher.dispatch('execute', { id: 'a' });
        await drain();
        const stopped = worker.stop().then(() => { order.push('stopped'); });

        await drain();
        expect(order).toEqual([]);
        expect(component.lifecycle).toEqual(['start']);

        blocker.resolve();
        await stopped;

        expect(component.handled).toEqual(['a']);
        expect(order).toEqual(['stopped']);
        expect(component.lifecycle).toEqual(['start', 'stop']);

        // no longer consuming
        await dispatcher.dispatch('execute', { id: 'b' });
        await drain();
        expect(component.handled).toEqual(['a']);
    });

    it('should start again after stop', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const worker = new RemoteWorker(component, { messageBus, consume: commands });

        await worker.start();
        await worker.stop();
        await worker.start();
        await dispatcher.dispatch('execute', { id: 'a' });
        await drain();

        expect(component.handled).toEqual(['a']);
        expect(component.lifecycle).toEqual(['start', 'stop', 'start']);
    });

    it('should delegate status to the component', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const worker = new RemoteWorker(component, { messageBus, consume: commands });
        await worker.start();

        await dispatcher.dispatch('execute', { id: 'a' });
        await drain();
        expect(worker.status()).toEqual(component.status());
        expect(worker.status().lastSuccessAt).toBeTypeOf('number');
    });

    it('should leave no consumer when stopped during start', async () => {
        const messageBus = new FakeMessageBus();
        const component = new BlockedStartComponent();
        const worker = new RemoteWorker(component, { messageBus, consume: commands });

        const started = worker.start();
        const stopped = worker.stop();
        component.gate.resolve();
        await Promise.all([started, stopped]);

        expect(messageBus.active).toBe(0);
        expect(component.lifecycle).toEqual(['start', 'stop']);
    });

    it('should leave no consumer when stopped while consume is pending', async () => {
        const messageBus = new FakeMessageBus();
        const gate = Promise.withResolvers<void>();
        messageBus.consumeGate = gate.promise;
        const worker = new RemoteWorker(new TestComponent(), { messageBus, consume: commands });

        const started = worker.start();
        const stopped = worker.stop();
        gate.resolve();
        await Promise.all([started, stopped]);

        expect(messageBus.consumed).toHaveLength(1);
        expect(messageBus.active).toBe(0);
    });

    it('should register one consumer when started twice', async () => {
        const messageBus = new FakeMessageBus();
        const worker = new RemoteWorker(new TestComponent(), { messageBus, consume: commands });

        await Promise.all([worker.start(), worker.start()]);

        expect(messageBus.consumed).toHaveLength(1);
    });

    it('should stay stopped when consume fails, and start later', async () => {
        const messageBus = new FakeMessageBus();
        messageBus.consumeError = new Error('x');
        const component = new TestComponent();
        const worker = new RemoteWorker(component, { messageBus, consume: commands });

        await expect(worker.start()).rejects.toThrow('x');
        expect(component.lifecycle).toEqual(['start', 'stop']);

        messageBus.consumeError = undefined;
        await expect(worker.start()).resolves.toBeUndefined();
        expect(messageBus.active).toBe(1);
    });

    it('should start again only after a stop in flight released', async () => {
        const messageBus = new FakeMessageBus();
        const component = new TestComponent();
        const worker = new RemoteWorker(component, { messageBus, consume: commands });
        await worker.start();

        const stopped = worker.stop();
        await worker.start();
        await stopped;

        expect(component.lifecycle).toEqual(['start', 'stop', 'start']);
        expect(messageBus.active).toBe(1);
        expect(messageBus.consumed).toHaveLength(2);
    });

    it('should end stopped when stop() follows a start() waiting for a release', async () => {
        const messageBus = new FakeMessageBus();
        const component = new TestComponent();
        const worker = new RemoteWorker(component, { messageBus, consume: commands });
        await worker.start();

        await Promise.all([worker.stop(), worker.start(), worker.stop()]);

        expect(component.lifecycle).toEqual(['start', 'stop', 'start', 'stop']);
        expect(messageBus.active).toBe(0);
    });

    it('should never overlap acquire and release across stop/start/stop/start', async () => {
        const messageBus = new FakeMessageBus();
        const log: string[] = [];
        const tick = () => new Promise((resolve) => { setTimeout(resolve, 2); });
        const component = new TestComponent();
        component.start = async () => { log.push('start>'); await tick(); log.push('<start'); };
        component.stop = async () => { log.push('stop>'); await tick(); log.push('<stop'); };
        const worker = new RemoteWorker(component, { messageBus, consume: commands });
        await worker.start();

        await Promise.all([worker.stop(), worker.start(), worker.stop(), worker.start()]);

        expect(log).toEqual([
            'start>', 
            '<start',
            'stop>', 
            '<stop',
            'start>', 
            '<start',
            'stop>', 
            '<stop',
            'start>', 
            '<start',
        ]);
        expect(messageBus.active).toBe(1);
    });

    it('should resolve stop() when a concurrent start() fails', async () => {
        const messageBus = new FakeMessageBus();
        messageBus.consumeError = new Error('x');
        const component = new TestComponent();
        const worker = new RemoteWorker(component, { messageBus, consume: commands });

        const started = worker.start();
        const stopped = worker.stop();

        await expect(started).rejects.toThrow('x');
        await expect(stopped).resolves.toBeUndefined();
        expect(component.lifecycle).toEqual(['start', 'stop']);
    });

    it('should reject start() with the consume error even when component.stop() fails', async () => {
        const messageBus = new FakeMessageBus();
        messageBus.consumeError = new Error('consume');
        const component = new TestComponent();
        component.stop = async () => {
            component.lifecycle.push('stop');
            throw new Error('stop');
        };

        await expect(new RemoteWorker(component, { messageBus, consume: commands }).start())
            .rejects.toThrow('consume');
        expect(component.lifecycle).toEqual(['start', 'stop']);
    });

    it('should start after a stop whose release failed, leaving the error to stop()', async () => {
        const messageBus = new FakeMessageBus();
        const component = new TestComponent();
        component.stop = async () => {
            component.lifecycle.push('stop');
            throw new Error('stop');
        };
        const worker = new RemoteWorker(component, { messageBus, consume: commands });
        await worker.start();

        const stopped = worker.stop();
        const started = worker.start();

        await expect(stopped).rejects.toThrow('stop');
        await expect(started).resolves.toBeUndefined();
        expect(component.lifecycle).toEqual(['start', 'stop', 'start']);
        expect(messageBus.consumed).toHaveLength(2);
    });

    it('should stop the component even when cancelling the consumer fails', async () => {
        const messageBus = new FakeMessageBus();
        const component = new TestComponent();
        const worker = new RemoteWorker(component, { messageBus, consume: commands });
        await worker.start();
        messageBus.cancelError = new Error('cancel');

        await expect(worker.stop()).rejects.toThrow('cancel');
        expect(component.lifecycle).toEqual(['start', 'stop']);
    });

    it('should end stopped when component.start() stops its own worker', async () => {
        const messageBus = new FakeMessageBus();
        const component = new TestComponent();
        let stopped: Promise<void> | undefined;
        const worker = new RemoteWorker(component, { messageBus, consume: commands });
        component.start = async () => {
            component.lifecycle.push('start');
            stopped = worker.stop();
        };

        await worker.start();
        await stopped;

        expect(component.lifecycle).toEqual(['start', 'stop']);
        expect(messageBus.active).toBe(0);
    });

    it('should resolve a concurrent stop only after the component stopped', async () => {
        const messageBus = new FakeMessageBus();
        const component = new TestComponent();
        const worker = new RemoteWorker(component, { messageBus, consume: commands });
        await worker.start();

        const seen: string[][] = [];
        await Promise.all([
            worker.stop().then(() => { seen.push([...component.lifecycle]); }),
            worker.stop().then(() => { seen.push([...component.lifecycle]); }),
        ]);

        expect(seen).toEqual([['start', 'stop'], ['start', 'stop']]);
        expect(messageBus.active).toBe(0);
    });
});
