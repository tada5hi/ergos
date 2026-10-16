import { describe, expect, it } from 'vitest';
import {
    Component,
    MemoryMessageBusDriver,
    MessageBus,
    RemoteDispatcher,
    RemoteWorker,
} from '../../src';
import type { ForwardedEvent, Message, MessageRouting } from '../../src';
import type { TestEventMap } from './fakes/component';
import { TestComponent } from './fakes/component';
import { FakeMessageBus } from './fakes/message-bus';

const commands: MessageRouting = { type: 'work', key: 'commands' };
const replies: MessageRouting = { type: 'work', key: 'replies' };

function setup() {
    const messageBus = new MessageBus({ driver: new MemoryMessageBusDriver() });
    const component = new TestComponent();
    const dispatcher = new RemoteDispatcher<TestEventMap>({ messageBus, routing: commands });

    return {
        messageBus,
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
            reply: replies,
        }).start();
        await new RemoteWorker(inbox, { messageBus, consume: replies }).start();

        const { correlationId } = await dispatcher.dispatch('execute', { id: 'a' });

        expect(recorded).toEqual([{ id: 'a' }, correlationId]);
    });

    it('should clean the forwarded metadata', async () => {
        const { messageBus, dispatcher } = setup();
        const attempts: unknown[] = [];
        const component = new Component<TestEventMap>();
        component.mount('execute', async (data, ctx) => {
            attempts.push(ctx.metadata.attempt);
            await ctx.handle('executionFinished', data);
        });
        const received = await consumeReplies(messageBus);

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            reply: replies,
        }).start();

        const before = Date.now();
        await dispatcher.dispatch('execute', { id: 'a' }, {
            attempt: 5,
            persistent: true,
            correlationId: 'c',
        });

        expect(attempts).toEqual([5]);
        expect(received).toHaveLength(1);
        const metadata = received[0]?.metadata;
        expect(metadata).toMatchObject({ correlationId: 'c', routing: replies });
        expect(metadata).not.toHaveProperty('attempt');
        expect(metadata).not.toHaveProperty('persistent');
        expect(metadata?.timestamp).toBeGreaterThanOrEqual(before);
    });

    it('should forward an unknown command to reply', async () => {
        const { messageBus, component } = setup();
        const received = await consumeReplies(messageBus);

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            reply: replies,
        }).start();
        await new RemoteDispatcher({ messageBus, routing: commands }).dispatch('nope', {});

        expect(received.map((message) => message.type)).toEqual(['nope']);
    });

    it('should report a forwarded event with no reply routing to onUnrouted', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const unrouted: ForwardedEvent<TestEventMap>[] = [];

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            hooks: { onUnrouted: (event) => { unrouted.push(event); } },
        }).start();
        const { correlationId } = await dispatcher.dispatch('execute', { id: 'a' });

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

        await expect(dispatcher.dispatch('execute', { id: 'a' })).resolves.toMatchObject({ delivered: true });
        expect(component.handled).toEqual(['a']);
    });

    it('should report an undelivered forwarded event and still settle the command', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const undelivered: Message[] = [];

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            reply: replies,
            hooks: { onUndelivered: (message) => { undelivered.push(message); } },
        }).start();

        await expect(dispatcher.dispatch('execute', { id: 'a' })).resolves.toMatchObject({ delivered: true });
        expect(undelivered.map((message) => message.type)).toEqual(['executionFinished']);
    });

    it('should settle the command when onUndelivered throws', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();

        await new RemoteWorker(component, {
            messageBus,
            consume: commands,
            reply: replies,
            hooks: { onUndelivered: () => { throw new Error('hook'); } },
        }).start();

        await expect(dispatcher.dispatch('execute', { id: 'a' })).resolves.toMatchObject({ delivered: true });
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
        const dispatched = dispatcher.dispatch('execute', { id: 'a' });
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        const stopped = worker.stop().then(() => { order.push('stopped'); });

        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(order).toEqual([]);

        blocker.resolve();
        await Promise.all([dispatched, stopped]);

        expect(component.handled).toEqual(['a']);
        expect(order).toEqual(['stopped']);
        expect(component.lifecycle).toEqual(['start', 'stop']);

        // no longer consuming
        await dispatcher.dispatch('execute', { id: 'b' });
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
