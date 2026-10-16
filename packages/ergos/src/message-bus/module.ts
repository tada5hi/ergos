import type {
    IMessageBus,
    IMessageBusConsumer,
    IMessageBusDriver,
    Message,
    MessageBusOptions,
    MessageBusPublishOptions,
    MessageHandler,
    MessageHandlers,
    MessageRouting,
} from './types';

export class MessageBus implements IMessageBus {
    protected driver: IMessageBusDriver;

    protected logger?: MessageBusOptions['logger'];

    constructor(options: MessageBusOptions) {
        this.driver = options.driver;
        this.logger = options.logger;
    }

    publish(message: Message, options: MessageBusPublishOptions = {}): Promise<boolean> {
        if (options.logging ?? true) {
            this.logger?.debug(`Publishing queue message ${message.type} in ${message.metadata.routing.key}`);
        }

        return this.driver.publish(message.metadata.routing, message);
    }

    consumeAny(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        return this.consume(routing, { '*': handler });
    }

    consume(routing: MessageRouting, handlers: MessageHandlers): Promise<IMessageBusConsumer> {
        return this.driver.consume(routing, async (message) => {
            this.logger?.debug(`Consuming queue message ${message.type} in ${routing.key}`);

            // own keys only: a type such as 'toString' must not hit Object.prototype
            const handler = (Object.hasOwn(handlers, message.type) ? handlers[message.type] : undefined) ??
                handlers['*'];
            if (!handler) {
                this.logger?.debug(`No queue handler to consume message ${message.type} in ${routing.key}`);
                return;
            }

            try {
                await handler(message);
            } catch (e) {
                this.logger?.error(e);
                throw e;
            }
        });
    }
}
