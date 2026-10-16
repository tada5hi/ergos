import { invokeHook } from '../hook';
import type {
    IMessageBus,
    IMessageBusConsumer,
    IMessageBusDriver,
    Message,
    MessageBusHooks,
    MessageBusOptions,
    MessageHandler,
    MessageHandlers,
    MessageRouting,
} from './types';

export class MessageBus implements IMessageBus {
    protected driver: IMessageBusDriver;

    protected hooks?: MessageBusHooks;

    constructor(options: MessageBusOptions) {
        this.driver = options.driver;
        this.hooks = options.hooks;
    }

    publish(message: Message): Promise<boolean> {
        invokeHook(this.hooks, 'onPublish', message);

        return this.driver.publish(message.metadata.routing, message);
    }

    consumeAny(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        return this.consume(routing, { '*': handler });
    }

    consume(routing: MessageRouting, handlers: MessageHandlers): Promise<IMessageBusConsumer> {
        return this.driver.consume(routing, async (message) => {
            invokeHook(this.hooks, 'onConsume', message, routing);

            // own keys only: a type such as 'toString' must not hit Object.prototype
            const handler = (Object.hasOwn(handlers, message.type) ? handlers[message.type] : undefined) ??
                handlers['*'];
            if (!handler) {
                invokeHook(this.hooks, 'onUnhandled', message, routing);
                return;
            }

            try {
                await handler(message);
            } catch (e) {
                invokeHook(this.hooks, 'onError', e, message, routing);
                throw e;
            }
        });
    }
}
