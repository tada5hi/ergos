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
 */
export class FakeMessageBus implements IMessageBus {
    published: Message[] = [];

    consumed: { routing: MessageRouting, handlers: MessageHandlers }[] = [];

    accepted = true;

    async publish(message: Message): Promise<boolean> {
        this.published.push(message);
        return this.accepted;
    }

    async consume(routing: MessageRouting, handlers: MessageHandlers): Promise<IMessageBusConsumer> {
        this.consumed.push({ routing, handlers });
        return { cancel: async () => {} };
    }

    consumeAny(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        return this.consume(routing, { '*': handler });
    }
}
