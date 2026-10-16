import { MessageBusRoutingType } from './constants';
import type {
    IMessageBusConsumer,
    IMessageBusDriver,
    MessageBusHandler,
    MessageBusPayload,
    MessageBusRouting,
} from './types';

type MemoryConsumer = {
    routing: MessageBusRouting,
    handler: MessageBusHandler,
    inFlight: Set<Promise<void>>,
};

/**
 * In-process driver: WORK round-robins over the matching consumers, PUB_SUB
 * fans out. publish() awaits the handlers and rejects with their errors.
 */
export class MemoryMessageBusDriver implements IMessageBusDriver {
    protected consumers: MemoryConsumer[] = [];

    protected workIndex = 0;

    async publish(routing: MessageBusRouting, message: MessageBusPayload): Promise<boolean> {
        const matching = this.consumers.filter(
            (consumer) => consumer.routing.key === routing.key &&
                consumer.routing.type === routing.type &&
                (consumer.routing.namespace || '') === (routing.namespace || ''),
        );

        if (matching.length === 0) {
            return false;
        }

        if (routing.type === MessageBusRoutingType.WORK) {
            const consumer = matching[this.workIndex % matching.length];
            this.workIndex++;
            if (consumer) {
                await this.deliver(consumer, message);
            }

            return true;
        }

        for (const consumer of matching) {
            await this.deliver(consumer, message);
        }

        return true;
    }

    async consume(routing: MessageBusRouting, handler: MessageBusHandler): Promise<IMessageBusConsumer> {
        const consumer: MemoryConsumer = {
            routing, 
            handler, 
            inFlight: new Set(), 
        };
        this.consumers.push(consumer);

        return {
            cancel: async () => {
                this.consumers = this.consumers.filter((item) => item !== consumer);
                await Promise.allSettled(consumer.inFlight);
            },
        };
    }

    protected async deliver(consumer: MemoryConsumer, message: MessageBusPayload): Promise<void> {
        const promise = Promise.resolve().then(() => consumer.handler(message));
        consumer.inFlight.add(promise);
        try {
            await promise;
        } finally {
            consumer.inFlight.delete(promise);
        }
    }
}
