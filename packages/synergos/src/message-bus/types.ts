import type { ObjectLiteral } from '../types';
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
    /**
     * The 1-based delivery attempt of a consumed message, set by a driver that
     * retries (amqp: WORK routings); absent otherwise. Lets a handler tell its
     * last attempt apart. Not part of the published body.
     */
    attempt?: number,
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

/**
 * Observers (logging, metrics). A hook that throws is ignored (see invokeHook).
 */
export type MessageBusHooks = {
    /**
     * Before the message is handed to the driver.
     */
    onPublish?(message: Message): void,
    /**
     * A message arrived, before it is dispatched to a handler.
     */
    onConsume?(message: Message, routing: MessageRouting): void,
    /**
     * No handler (and no '*') accepted the message; it is settled (acked) without error.
     */
    onUnhandled?(message: Message, routing: MessageRouting): void,
    /**
     * The handler threw; the error is rethrown afterwards (the driver retries or nacks).
     */
    onError?(error: unknown, message: Message, routing: MessageRouting): void,
};

export type MessageBusOptions = {
    driver: IMessageBusDriver,
    hooks?: MessageBusHooks,
};

/**
 * What dispatchers, workers and components depend on; MessageBus is the implementation.
 */
export interface IMessageBus {
    /**
     * Resolves true once a consumer (memory) or the broker (amqp) accepted it.
     */
    publish(message: Message): Promise<boolean>;
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
