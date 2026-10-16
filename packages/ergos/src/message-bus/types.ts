import type { ILogger, ObjectLiteral } from '../types';
import type { MessageRoutingType } from './constants';

export type MessageRouting = {
    type: `${MessageRoutingType}`,
    key: string,
    namespace?: string,
    /**
     * WORK only: deliver to one consumer at a time, in publish order, with
     * failover to another replica (AMQP single active consumer). For replies
     * whose handlers must not race each other across replicas.
     */
    ordered?: boolean,
};

export type MessageMetadata = {
    timestamp: number,
    persistent?: boolean,
    routing: MessageRouting,
};

export type MessageBusPublishOptions = {
    logging?: boolean,
};

export type Message<
    T = string,
    D = ObjectLiteral,
> = {
    id: string,
    type: T,
    data: D,
    metadata: MessageMetadata,
};

export type MessageMetadataInput = Partial<Pick<MessageMetadata, 'timestamp'>> &
    Omit<MessageMetadata, 'timestamp'>;

export type MessageInput<
    T = string,
    D = ObjectLiteral,
> = {
    id?: string,
    type: T,
    data?: D,
    metadata: MessageMetadataInput,
};

export type MessageHandler<
    T = string,
    D = ObjectLiteral,
> = (message: Message<T, D>) => Promise<void> | void;

export type MessageHandlers = {
    '*'?: MessageHandler,
    [type: string]: MessageHandler | undefined,
};

export interface IMessageBusConsumer {
    /**
     * Stop receiving messages. Resolves once the handlers in flight settled.
     */
    cancel(): Promise<void>;
}

export type MessageBusOptions = {
    driver: IMessageBusDriver,
    logger?: ILogger,
};

/**
 * What callers and components depend on; MessageBus is the implementation.
 */
export interface IMessageBus {
    /**
     * Resolves true once a consumer (memory) or the broker (amqp) accepted it.
     */
    publish(message: Message, options?: MessageBusPublishOptions): Promise<boolean>;
    /**
     * A handler for the message type wins over '*'. A message no handler
     * accepts is settled (acked) without error.
     */
    consume(routing: MessageRouting, handlers: MessageHandlers): Promise<IMessageBusConsumer>;
    /**
     * consume() with a single '*' handler.
     */
    consumeAny(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer>;
}

export interface IMessageBusDriver {
    /**
     * Resolves true once a consumer (memory) or the broker (amqp) accepted it.
     */
    publish(routing: MessageRouting, message: Message): Promise<boolean>;
    consume(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer>;
    close?(): Promise<void>;
}
