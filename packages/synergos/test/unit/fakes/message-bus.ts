import type {
    IMessageBus,
    IMessageBusConsumer,
    Message,
    MessageHandler,
    MessageHandlers,
    MessageRouting,
} from '../../../src';

/**
 * Records publishes; answers each with `accepted`. Consumers are recorded, never fed.
 * `consume` awaits `consumeGate`, rejects with `consumeError`; `active` counts uncancelled consumers.
 */
export class FakeMessageBus implements IMessageBus {
    published: Message[] = [];

    consumed: { routing: MessageRouting, handlers: MessageHandlers }[] = [];

    accepted = true;

    consumeGate: Promise<void> | undefined;

    consumeError: unknown;

    active = 0;

    async publish(message: Message): Promise<boolean> {
        this.published.push(message);
        return this.accepted;
    }

    async consume(routing: MessageRouting, handlers: MessageHandlers): Promise<IMessageBusConsumer> {
        await this.consumeGate;
        if (this.consumeError) {
            throw this.consumeError;
        }

        this.consumed.push({ routing, handlers });
        this.active++;

        return { cancel: async () => { this.active--; } };
    }

    consumeAny(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        return this.consume(routing, { '*': handler });
    }
}
