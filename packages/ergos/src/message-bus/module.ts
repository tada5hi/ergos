import type { ILogger } from '../types';
import type {
    IMessageBusConsumer,
    IMessageBusDriver,
    Message,
    MessageBusPublishOptions,
    MessageHandler,
    MessageHandlers,
    MessageRouting,
} from './types';

export type MessageBusOptions = {
    driver: IMessageBusDriver,
    logger?: ILogger,
};

export class MessageBus {
    protected driver: IMessageBusDriver;

    protected logger?: ILogger;

    constructor(ctx: MessageBusOptions) {
        this.driver = ctx.driver;
        this.logger = ctx.logger;
    }

    publish(message: Message, options: MessageBusPublishOptions = {}): Promise<boolean> {
        if (options.logging ?? true) {
            this.logger?.debug(`Publishing queue message ${message.type} in ${message.metadata.routing.key}`);
        }

        return this.driver.publish(message.metadata.routing, message);
    }

    consumeAny(routing: MessageRouting, fn: MessageHandler): Promise<IMessageBusConsumer> {
        return this.consume(routing, { '*': fn });
    }

    /**
     * A handler for the message type wins over '*'. A message no handler
     * accepts is settled (acked) without error.
     */
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
