import { describe, expect, it } from 'vitest';
import {
    DispatchCaller,
    MemoryMessageBusDriver,
    MessageBus,
    WorkerCaller,
} from '../../src';
import type { Message, MessageRouting } from '../../src';
import { TestComponent } from './fakes/component';

const consumeRouting: MessageRouting = { type: 'work', key: 'commands' };
const publishRouting: MessageRouting = { type: 'work', key: 'replies' };

function setup() {
    const messageBus = new MessageBus({ driver: new MemoryMessageBusDriver() });
    const component = new TestComponent();
    const dispatcher = new DispatchCaller({ routing: consumeRouting, messageBus });

    return {
        messageBus, 
        component, 
        dispatcher,
    };
}

describe('src/caller/worker', () => {
    it('should publish an unhandled child event to publishRouting', async () => {
        const {
            messageBus, 
            component, 
            dispatcher,
        } = setup();
        const replies: Message[] = [];
        await messageBus.consumeAny(publishRouting, (message) => { replies.push(message); });

        const worker = new WorkerCaller(component, {
            consumeRouting, 
            publishRouting, 
            messageBus, 
        });
        await worker.start();
        await dispatcher.call('execute', { id: 'a' }, { correlationId: 'c' });

        expect(replies).toHaveLength(1);
        expect(replies[0]?.type).toBe('executionFinished');
        expect(replies[0]?.data).toEqual({ id: 'a' });
        expect(replies[0]?.metadata).toMatchObject({ correlationId: 'c', routing: publishRouting });
        expect(component.lifecycle).toEqual(['start']);
    });

    it('should not leak the command\'s retry counter into its reply', async () => {
        const {
            messageBus,
            component,
            dispatcher,
        } = setup();
        const replies: Message[] = [];
        await messageBus.consumeAny(publishRouting, (message) => { replies.push(message); });

        const worker = new WorkerCaller(component, {
            consumeRouting,
            publishRouting,
            messageBus,
        });
        await worker.start();
        // an older producer counts attempts in the body
        await dispatcher.call('execute', { id: 'a' }, { attempt: 5, correlationId: 'c' });

        expect(replies[0]?.metadata).toMatchObject({ correlationId: 'c' });
        expect(replies[0]?.metadata).not.toHaveProperty('attempt');
    });

    it('should stamp a reply with its own timestamp, not the command\'s transport metadata', async () => {
        const {
            messageBus,
            component,
            dispatcher,
        } = setup();
        const replies: Message[] = [];
        await messageBus.consumeAny(publishRouting, (message) => { replies.push(message); });

        const worker = new WorkerCaller(component, {
            consumeRouting,
            publishRouting,
            messageBus,
        });
        await worker.start();
        await dispatcher.call('execute', { id: 'a' }, {
            correlationId: 'c', 
            timestamp: 1, 
            persistent: false, 
        });

        expect(replies[0]?.metadata.timestamp).toBeGreaterThan(1);
        expect(replies[0]?.metadata).not.toHaveProperty('persistent');
    });

    it('should report a child event with nowhere to go to onUnrouted', async () => {
        const {
            messageBus,
            component,
            dispatcher,
        } = setup();
        const unrouted: unknown[][] = [];
        const worker = new WorkerCaller(component, {
            consumeRouting,
            messageBus,
            hooks: { onUnrouted: (...args) => { unrouted.push(args); } },
        });
        await worker.start();
        await dispatcher.call('execute', { id: 'a' }, { correlationId: 'c' });

        expect(component.handled).toEqual(['a']);
        expect(unrouted).toHaveLength(1);
        expect(unrouted[0]?.[0]).toBe('executionFinished');
        expect(unrouted[0]?.[1]).toEqual({ id: 'a' });
        expect(unrouted[0]?.[2]).toMatchObject({ correlationId: 'c' });
    });

    it('should settle the command when onUnrouted throws', async () => {
        const {
            messageBus,
            component,
            dispatcher,
        } = setup();
        const worker = new WorkerCaller(component, {
            consumeRouting,
            messageBus,
            hooks: { onUnrouted: () => { throw new Error('hook'); } },
        });
        await worker.start();

        await expect(dispatcher.call('execute', { id: 'a' }, {})).resolves.toBeUndefined();
    });

    it('should resolve an unknown command silently (no retry loop)', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const worker = new WorkerCaller(component, {
            consumeRouting, 
            publishRouting, 
            messageBus, 
        });
        await worker.start();

        await expect(dispatcher.call('nope', {}, {})).resolves.toBeUndefined();
    });

    it('should stop only after the handler in flight finished', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const blocker = Promise.withResolvers<void>();
        component.blocker = blocker.promise;

        const worker = new WorkerCaller(component, { consumeRouting, messageBus });
        await worker.start();

        const order: string[] = [];
        const dispatched = dispatcher.call('execute', { id: 'a' }, {});
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
        await dispatcher.call('execute', { id: 'b' }, {});
        expect(component.handled).toEqual(['a']);
    });


    it('should delegate status to the component', async () => {
        const { messageBus, component } = setup();
        const worker = new WorkerCaller(component, { consumeRouting, messageBus });

        await worker.call('execute', { id: 'a' }, {});
        expect(worker.status()).toEqual(component.status());
        expect(worker.status().lastSuccessAt).toBeTypeOf('number');
    });
});
