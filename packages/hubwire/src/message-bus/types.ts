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
    /**
     * PUB_SUB consume only: a durable subscription. Consumers naming the same
     * queue share its messages (each once, retried like WORK); every queue name
     * and every consumer without one gets its own copy. Publishers omit it.
     */
    queue?: string,
    /**
     * Publish only: whether the routing's messages survive a broker restart
     * (amqp default: WORK yes, PUB_SUB no). A message's metadata.persistent
     * wins. The memory driver ignores it.
     */
    persistent?: boolean,
};

export type MessageMetadata = {
    timestamp: number,
    persistent?: boolean,
    /**
     * Epoch ms after which the message is settled (acked) unhandled and
     * reported to onExpired. amqp also hands it to the broker as expiration.
     */
    expiresAt?: number,
    routing: MessageRouting,
    /**
     * Set by every driver on consume, never published: lets a handler tell
     * its last attempt apart.
     */
    delivery?: MessageDelivery,
};

export type MessageDelivery = {
    /**
     * 1-based.
     */
    attempt: number,
    /**
     * 1 for a driver or routing that does not retry.
     */
    maxAttempts: number,
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
     * metadata.expiresAt had passed on consume; the message is settled (acked) without a handler.
     */
    onExpired?(message: Message, routing: MessageRouting): void,
    /**
     * The handler threw; the error is rethrown afterwards (amqp retries or drops it, memory drops it).
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
     * See IMessageBusDriver.publish().
     */
    publish(message: Message): Promise<void>;
    /**
     * A handler for the message type wins over '*'. A message no handler
     * accepts is settled (acked) without error.
     */
    consume(routing: MessageRouting, handlers: MessageHandlers): Promise<IMessageBusConsumer>;
    /**
     * consume() with a single '*' handler.
     */
    consumeAny(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer>;
    close(): Promise<void>;
}

/**
 * The contract every driver keeps, pinned by `hubwire/conformance`.
 */
export interface IMessageBusDriver {
    /**
     * Hands the message to the transport (amqp: broker confirm; memory: enqueue)
     * and resolves; it never waits for a handler, and a handler error never
     * reaches it. Rejects only when the hand-off fails, e.g. after close().
     */
    publish(routing: MessageRouting, message: Message): Promise<void>;
    /**
     * WORK (with or without namespace): each message reaches one consumer;
     * PUB_SUB: every consumer, except that the consumers naming the same
     * PUB_SUB queue share one copy. An ordered routing runs one handler at a
     * time. The handler's message carries metadata.delivery. Rejects after
     * close().
     */
    consume(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer>;
    /**
     * Later publishes and consumes reject.
     */
    close(): Promise<void>;
}
