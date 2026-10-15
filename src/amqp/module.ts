import { Client, ExchangeType } from 'amqp-extension';
import type { ConsumeOptions, QueueOptions } from 'amqp-extension';
import {
    MessageBusRoutingType,
    isMessageBusPayload,
    serializeMessageBusPayload,
} from '../message-bus';
import type {
    IMessageBusConsumer,
    IMessageBusDriver,
    MessageBusHandler,
    MessageBusPayload,
    MessageBusRouting,
} from '../message-bus';
import type { ILogger } from '../types';
import type { AmqpMessageBusDriverOptions, IAmqpClient } from './types';

/**
 * Maps the message bus onto amqp-extension. WORK routings go through the default
 * (direct) exchange and are retried by amqp-extension (x-attempt header, backoff,
 * redelivery guard); PUB_SUB routings go through a topic exchange and are not retried.
 * Delivery is at-least-once.
 */
export class AmqpMessageBusDriver implements IMessageBusDriver {
    protected options: AmqpMessageBusDriverOptions;

    protected clientInstance: IAmqpClient | undefined;

    protected connectionString: string | undefined;

    protected logger?: ILogger;

    constructor(options: AmqpMessageBusDriverOptions) {
        this.options = options;
        this.logger = options.logger;
        if ('client' in options) {
            this.clientInstance = options.client;
        } else {
            this.connectionString = options.connectionString;
        }
    }

    protected get client(): IAmqpClient {
        if (!this.clientInstance) {
            if (!this.connectionString) {
                throw new Error('The amqp message bus driver was closed.');
            }

            // lazy: constructing the driver must not connect
            this.clientInstance = new Client({ connectionOptions: this.connectionString });
        }

        return this.clientInstance;
    }

    async publish(routing: MessageBusRouting, message: MessageBusPayload): Promise<boolean> {
        // Resolves once the broker confirmed the message (a rejection throws);
        // amqplib's boolean only reports write-buffer backpressure.
        await this.resolveExchange(routing).publish(routing.key, serializeMessageBusPayload(message), {
            type: message.type,
            messageId: message.id,
            persistent: message.metadata.persistent ?? routing.type === MessageBusRoutingType.WORK,
            ...this.resolveQueueOptions(routing),
        });

        return true;
    }

    async consume(routing: MessageBusRouting, handler: MessageBusHandler): Promise<IMessageBusConsumer> {
        const isWork = routing.type === MessageBusRoutingType.WORK;
        const options: ConsumeOptions = {
            prefetchCount: this.options.prefetchCount ?? 1,
            // reached only when a retry re-publish fails: the message comes back as a redelivery
            requeueOnFailure: isWork,
            ...this.resolveQueueOptions(routing),
        };
        if (isWork) {
            options.retry = {
                maxAttempts: this.options.maxAttempts ?? 5,
                delay: this.options.retryDelay ?? 1000,
            };
        }
        if (routing.ordered) {
            options.ordered = true;
        }

        return this.resolveExchange(routing).consume(routing.key, options, {
            $any: async (input) => {
                let payload: unknown;
                try {
                    payload = JSON.parse(new TextDecoder().decode(input.content));
                } catch {
                    this.logger?.warn(`Could not parse message in ${routing.key}.`);
                    return;
                }

                if (!isMessageBusPayload(payload)) {
                    this.logger?.warn(`Dropping malformed message in ${routing.key}.`);
                    return;
                }

                await handler(payload);
            },
        });
    }

    async close(): Promise<void> {
        const client = this.clientInstance;
        this.clientInstance = undefined;
        this.connectionString = undefined;
        await client?.close();
    }

    /**
     * Publisher and consumer must declare the queue identically (the broker
     * answers a mismatch with 406), so both sides derive it from the routing.
     */
    protected resolveQueueOptions(routing: MessageBusRouting): QueueOptions {
        return routing.ordered ? { singleActiveConsumer: true } : {};
    }

    protected resolveExchange(routing: MessageBusRouting): IAmqpClient {
        if (routing.type === MessageBusRoutingType.WORK) {
            return this.client.of({ type: ExchangeType.DIRECT, name: routing.namespace || '' });
        }

        return this.client.of({ type: ExchangeType.TOPIC, name: routing.namespace || this.options.defaultTopicExchange });
    }
}
