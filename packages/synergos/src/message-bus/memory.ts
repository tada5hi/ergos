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
    routing: MessageRouting,
    index: number,
    pending: Message[],
    busy?: boolean,
};

/**
 * In-process driver with amqp's queue semantics: a WORK routing (per namespace and
 * key) is a durable queue (kept until consumed, round-robin, `ordered`: one consumer);
 * so is a PUB_SUB `queue`, once a consumer declared it (one copy per queue name).
 * Any other PUB_SUB routing gives each consumer its own copy and drops a message
 * nobody consumes. publish() ignores `queue`, only enqueues;
 * handlers run on a later microtask and their errors are dropped (there is no
 * retry: attempt 1 of 1). An `ordered` queue runs one handler at a time.
 * ponytail: otherwise no prefetch, a consumer's handlers may overlap.
 * ponytail: no JSON copy like amqp's; every consumer shares the published `data` object.
 */
export class MemoryMessageBusDriver implements IMessageBusDriver {
    protected consumers: MemoryConsumer[] = [];

    protected queues = new Map<string, MemoryQueue>();

    protected closed = false;

    async publish(routing: MessageRouting, message: Message): Promise<void> {
        if (this.closed) {
            throw new Error('The memory message bus driver was closed.');
        }

        // amqp: a publish declares no queue, so `queue` is a consumer's option only
        const queue = this.resolveQueue({ ...routing, queue: undefined });
        if (queue) {
            queue.pending.push(message);
            this.flush(queue);
            return;
        }

        for (const consumer of this.match(routing)) {
            if (!consumer.routing.queue) {
                this.deliver(consumer, message);
            }
        }

        for (const named of this.queues.values()) {
            if (named.routing.queue && this.same(named.routing, routing)) {
                named.pending.push(message);
                this.flush(named);
            }
        }
    }

    async consume(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        if (this.closed) {
            throw new Error('The memory message bus driver was closed.');
        }

        const consumer: MemoryConsumer = {
            routing,
            handler,
            inFlight: new Set(),
        };
        this.consumers.push(consumer);

        const queue = this.resolveQueue(routing);
        if (queue) {
            // the consumer declares the queue (ordered or not), not a publish that came first
            queue.routing = routing;
            this.flush(queue);
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

    /**
     * The durable queue of a WORK routing or of a PUB_SUB `queue`
     * (the latter only from consume(): publishers omit it).
     * ponytail: a named queue is keyed by its binding, so one name on two keys is two queues.
     * ponytail: amqp shares queue `key` between a namespaced and an un-namespaced WORK routing; memory does not.
     */
    protected resolveQueue(routing: MessageRouting): MemoryQueue | undefined {
        const isWork = routing.type === MessageRoutingType.WORK;
        if (!isWork && !routing.queue) {
            return undefined;
        }

        const name = JSON.stringify([routing.type, routing.namespace || '', routing.key, isWork ? '' : routing.queue]);
        let queue = this.queues.get(name);
        if (!queue) {
            queue = {
                routing,
                index: 0,
                pending: [],
            };
            this.queues.set(name, queue);
        }

        return queue;
    }

    protected flush(queue: MemoryQueue): void {
        const { routing } = queue;
        const matching = this.match(routing).filter((consumer) => consumer.routing.queue === routing.queue);
        while (matching.length > 0 && queue.pending.length > 0) {
            if (routing.ordered) {
                // amqp: single active consumer, prefetch 1
                if (queue.busy) {
                    return;
                }
                queue.busy = true;
                this.deliver(matching[0]!, queue.pending.shift()!).then(() => {
                    queue.busy = false;
                    this.flush(queue);
                });
                return;
            }
            this.deliver(matching[queue.index++ % matching.length]!, queue.pending.shift()!);
        }
    }

    protected match(routing: MessageRouting): MemoryConsumer[] {
        return this.consumers.filter((consumer) => this.same(consumer.routing, routing));
    }

    protected same(a: MessageRouting, b: MessageRouting): boolean {
        return a.key === b.key && a.type === b.type && (a.namespace || '') === (b.namespace || '');
    }

    protected deliver(consumer: MemoryConsumer, message: Message): Promise<void> {
        const copy = { ...message, metadata: { ...message.metadata, delivery: { attempt: 1, maxAttempts: 1 } } };
        const promise = Promise.resolve()
            .then(() => consumer.handler(copy))
            .catch(() => {});
        consumer.inFlight.add(promise);
        promise.then(() => consumer.inFlight.delete(promise));
        return promise;
    }
}
