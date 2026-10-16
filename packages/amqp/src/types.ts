import type {
    ConsumeOptions,
    Exchange,
    PublishOptions,
} from 'amqp-extension';
import type { IMessageBusConsumer, Message, MessageRouting } from 'busline';

export type AmqpDeliveryHandler = (message: {
    content: Uint8Array,
    properties: { headers?: Record<string, unknown> },
}) => Promise<void>;

/**
 * The part of amqp-extension's Client the driver uses; a Client satisfies it.
 */
export interface IAmqpClient {
    of(exchange: Exchange): IAmqpClient;
    publish(to: string, data: string, options: PublishOptions): Promise<boolean>;
    consume(from: string, options: ConsumeOptions, handlers: { $any: AmqpDeliveryHandler }): Promise<IMessageBusConsumer>;
    close(): Promise<void>;
}

/**
 * A retried message (WORK, or PUB_SUB through a named queue) whose handler failed.
 */
export type AmqpFailedMessage = {
    message: Message,
    routing: MessageRouting,
    /**
     * The attempt that failed (1-based, from the x-attempt header).
     */
    attempt: number,
    /**
     * The handler's error; undefined for a redelivery of a message whose consumer died.
     */
    error: unknown,
};

/**
 * A delivery that is not a message: not JSON (error is the parse error), or JSON
 * without the message shape (error is undefined). It is dropped (acked).
 */
export type AmqpMalformedMessage = {
    routing: MessageRouting,
    content: Uint8Array,
    error?: unknown,
};

/**
 * Observers (amqp-extension itself does not log). A hook that throws is ignored
 * (see invokeHook in busline).
 */
export type AmqpMessageBusDriverHooks = {
    /**
     * A failed retried message was re-published for another attempt (or requeued
     * when the re-publish failed).
     */
    onRetry?(failure: AmqpFailedMessage): void,
    /**
     * A retried message was dropped (acked) after maxAttempts.
     */
    onDrop?(failure: AmqpFailedMessage): void,
    onMalformed?(delivery: AmqpMalformedMessage): void,
};

export type AmqpMessageBusDriverOptions = ({ connectionString: string } | { client: IAmqpClient }) & {
    /**
     * Name of the topic exchange for a PUB_SUB routing without namespace.
     */
    defaultTopicExchange: string,
    hooks?: AmqpMessageBusDriverHooks,
    /**
     * Delivery attempts of a WORK message (or one consumed through a named PUB_SUB
     * queue) before it is dropped (default: 5).
     */
    maxAttempts?: number,
    /**
     * Base of the exponential retry backoff in ms (default: 1000, capped at 30s).
     */
    retryDelay?: number,
    /**
     * Unacked messages per consumer (default: 1). Handlers that
     * read-modify-write the same rows need 1.
     */
    prefetchCount?: number,
};
