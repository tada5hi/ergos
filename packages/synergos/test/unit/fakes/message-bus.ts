import type {
    IMessageBus,
    IMessageBusConsumer,
    Message,
    MessageHandler,
    MessageHandlers,
    MessageRouting,
} from '../../../src';

/**
 * Records publishes. Consumers are recorded, never fed.
 * `publish` rejects with `publishError`; `consume` awaits `consumeGate`, rejects with `consumeError`;
 * `cancel` rejects with `cancelError`;
 * `active` counts uncancelled consumers.
 */
export class FakeMessageBus implements IMessageBus {
    published: Message[] = [];

    consumed: { routing: MessageRouting, handlers: MessageHandlers }[] = [];

    consumeGate: Promise<void> | undefined;

    consumeError: unknown;

    cancelError: unknown;

    publishError: unknown;

    active = 0;

    async publish(message: Message): Promise<void> {
        if (this.publishError) {
            throw this.publishError;
        }
        this.published.push(message);
    }

    close(): Promise<void> { return Promise.resolve(); }

    async consume(routing: MessageRouting, handlers: MessageHandlers): Promise<IMessageBusConsumer> {
        await this.consumeGate;
        if (this.consumeError) {
            throw this.consumeError;
        }

        this.consumed.push({ routing, handlers });
        this.active++;

        return {
            cancel: async () => {
                if (this.cancelError) {
                    throw this.cancelError;
                }
                this.active--;
            },
        };
    }

    consumeAny(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        return this.consume(routing, { '*': handler });
    }
}
