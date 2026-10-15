import type {
    ConsumeOptions,
    Exchange,
    PublishOptions,
} from 'amqp-extension';
import type { IMessageBusConsumer } from '../message-bus';
import type { ILogger } from '../types';

export type AmqpDeliveryHandler = (message: { content: Uint8Array }) => Promise<void>;

/**
 * The part of amqp-extension's Client the driver uses; a Client satisfies it.
 */
export interface IAmqpClient {
    of(exchange: Exchange): IAmqpClient;
    publish(to: string, data: string, options: PublishOptions): Promise<boolean>;
    consume(from: string, options: ConsumeOptions, handlers: { $any: AmqpDeliveryHandler }): Promise<IMessageBusConsumer>;
    close(): Promise<void>;
}

export type AmqpMessageBusDriverOptions = ({ connectionString: string } | { client: IAmqpClient }) & {
    /**
     * Name of the topic exchange for a PUB_SUB routing without namespace.
     */
    defaultTopicExchange: string,
    logger?: ILogger,
    /**
     * Delivery attempts of a WORK message before it is dropped (default: 5).
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
