import { MessageRoutingType } from './constants';
import type {
    IMessageBusConsumer,
    IMessageBusDriver,
    Message,
    MessageHandler,
    MessageRouting,
} from './types';

type MemoryConsumer = {
    routing: MessageRouting,
    handler: MessageHandler,
    inFlight: Set<Promise<void>>,
};

type MemoryQueue = {
    index: number,
    pending: Message[],
};

/**
 * In-process driver with amqp's queue semantics: a WORK routing without namespace
 * is a durable queue (kept until consumed, round-robin, `ordered`: one consumer);
 * any other routing gives each consumer its own copy and drops a message nobody
 * consumes. publish() only enqueues; handlers run on a later microtask and their
 * errors are dropped (there is no retry: attempt 1 of 1).
 * ponytail: no prefetch, a consumer's handlers may overlap.
 */
export class MemoryMessageBusDriver implements IMessageBusDriver {
    protected consumers: MemoryConsumer[] = [];

    protected queues = new Map<string, MemoryQueue>();

    protected closed = false;

    async publish(routing: MessageRouting, message: Message): Promise<void> {
        if (this.closed) {
            throw new Error('The memory message bus driver was closed.');
        }

        const queue = this.resolveQueue(routing);
        if (queue) {
            queue.pending.push(message);
            this.flush(routing, queue);
            return;
        }

        for (const consumer of this.match(routing)) {
            this.deliver(consumer, message);
        }
    }

    async consume(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        const consumer: MemoryConsumer = {
            routing,
            handler,
            inFlight: new Set(),
        };
        this.consumers.push(consumer);

        const queue = this.resolveQueue(routing);
        if (queue) {
            this.flush(routing, queue);
        }

        return {
            cancel: async () => {
                this.consumers = this.consumers.filter((item) => item !== consumer);
                await Promise.all(consumer.inFlight);
            },
        };
    }

    async close(): Promise<void> {
        this.closed = true;
        this.consumers = [];
        this.queues.clear();
    }

    protected resolveQueue(routing: MessageRouting): MemoryQueue | undefined {
        // amqp: a namespaced WORK routing is a named direct exchange, consumed through exclusive queues
        if (routing.type !== MessageRoutingType.WORK || routing.namespace) {
            return undefined;
        }

        let queue = this.queues.get(routing.key);
        if (!queue) {
            queue = { index: 0, pending: [] };
            this.queues.set(routing.key, queue);
        }

        return queue;
    }

    protected flush(routing: MessageRouting, queue: MemoryQueue): void {
        const matching = this.match(routing);
        while (matching.length > 0 && queue.pending.length > 0) {
            const consumer = routing.ordered ? matching[0] : matching[queue.index++ % matching.length];
            this.deliver(consumer!, queue.pending.shift()!);
        }
    }

    protected match(routing: MessageRouting): MemoryConsumer[] {
        return this.consumers.filter(
            (consumer) => consumer.routing.key === routing.key &&
                consumer.routing.type === routing.type &&
                (consumer.routing.namespace || '') === (routing.namespace || ''),
        );
    }

    protected deliver(consumer: MemoryConsumer, message: Message): void {
        const copy = { ...message, metadata: { ...message.metadata, delivery: { attempt: 1, maxAttempts: 1 } } };
        const promise = Promise.resolve()
            .then(() => consumer.handler(copy))
            .catch(() => {});
        consumer.inFlight.add(promise);
        promise.then(() => consumer.inFlight.delete(promise));
    }
}
