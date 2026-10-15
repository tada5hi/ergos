import type { ILogger } from '../types';
import type {
    IMessageBusConsumer,
    IMessageBusDriver,
    MessageBusHandler,
    MessageBusHandlers,
    MessageBusPayload,
    MessageBusPublishOptions,
    MessageBusRouting,
} from './types';

export type MessageBusContext = {
    driver: IMessageBusDriver,
    logger?: ILogger,
};

export class MessageBus {
    protected driver: IMessageBusDriver;

    protected logger?: ILogger;

    constructor(ctx: MessageBusContext) {
        this.driver = ctx.driver;
        this.logger = ctx.logger;
    }

    publish(message: MessageBusPayload, options: MessageBusPublishOptions = {}): Promise<boolean> {
        if (options.logging ?? true) {
            this.logger?.debug(`Publishing queue message ${message.type} in ${message.metadata.routing.key}`);
        }

        return this.driver.publish(message.metadata.routing, message);
    }

    consumeAny(routing: MessageBusRouting, fn: MessageBusHandler): Promise<IMessageBusConsumer> {
        return this.consume(routing, { $any: fn });
    }

    /**
     * A handler for the message type wins over $any. A message no handler
     * accepts is settled (acked) without error.
     */
    consume(routing: MessageBusRouting, handlers: MessageBusHandlers): Promise<IMessageBusConsumer> {
        return this.driver.consume(routing, async (payload) => {
            this.logger?.debug(`Consuming queue message ${payload.type} in ${routing.key}`);

            // own keys only: a type such as 'toString' must not hit Object.prototype
            const handler = (Object.hasOwn(handlers, payload.type) ? handlers[payload.type] : undefined) ??
                handlers.$any;
            if (!handler) {
                this.logger?.debug(`No queue handler to consume message ${payload.type} in ${routing.key}`);
                return;
            }

            try {
                await handler(payload);
            } catch (e) {
                this.logger?.error(e);
                throw e;
            }
        });
    }
}
