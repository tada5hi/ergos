import { describe, expect, it } from 'vitest';
import {
    MemoryMessageBusDriver,
    MessageBus,
    MessageBusDispatchComponentCaller,
    MessageBusWorkerComponentCaller,
} from '../../src';
import type { MessageBusPayload, MessageBusRouting } from '../../src';
import { TestComponent } from './fakes/component';
import { FakeLogger } from './fakes/logger';

const consumeRouting: MessageBusRouting = { type: 'work', key: 'commands' };
const publishRouting: MessageBusRouting = { type: 'work', key: 'replies' };

function setup() {
    const messageBus = new MessageBus({ driver: new MemoryMessageBusDriver() });
    const component = new TestComponent();
    const logger = new FakeLogger();
    const dispatcher = new MessageBusDispatchComponentCaller({ routing: consumeRouting, messageBus });

    return {
        messageBus, 
        component, 
        logger, 
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
        const replies: MessageBusPayload[] = [];
        await messageBus.consumeAny(publishRouting, (payload) => { replies.push(payload); });

        const worker = new MessageBusWorkerComponentCaller(component, {
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
        const replies: MessageBusPayload[] = [];
        await messageBus.consumeAny(publishRouting, (payload) => { replies.push(payload); });

        const worker = new MessageBusWorkerComponentCaller(component, {
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

    it('should warn when a child event has nowhere to go', async () => {
        const {
            messageBus, 
            component, 
            logger, 
            dispatcher,
        } = setup();
        const worker = new MessageBusWorkerComponentCaller(component, {
            consumeRouting, 
            messageBus, 
            logger, 
        });
        await worker.start();
        await dispatcher.call('execute', { id: 'a' }, {});

        expect(component.handled).toEqual(['a']);
        expect(logger.messages('warn')).toHaveLength(1);
        expect(logger.messages('warn')[0]).toContain('executionFinished');
    });

    it('should resolve an unknown command silently (no retry loop)', async () => {
        const {
            messageBus, 
            component, 
            dispatcher, 
        } = setup();
        const worker = new MessageBusWorkerComponentCaller(component, {
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

        const worker = new MessageBusWorkerComponentCaller(component, { consumeRouting, messageBus });
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

    it('should start the component and warn without a message bus', async () => {
        const component = new TestComponent();
        const logger = new FakeLogger();
        const worker = new MessageBusWorkerComponentCaller(component, { consumeRouting, logger });

        await worker.start();
        await worker.stop();

        expect(component.lifecycle).toEqual(['start', 'stop']);
        expect(logger.messages('warn')).toHaveLength(1);
    });

    it('should delegate status to the component', async () => {
        const { messageBus, component } = setup();
        const worker = new MessageBusWorkerComponentCaller(component, { consumeRouting, messageBus });

        await worker.call('execute', { id: 'a' }, {});
        expect(worker.status()).toEqual(component.status());
        expect(worker.status().lastSuccessAt).toBeTypeOf('number');
    });
});
