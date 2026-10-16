import {
    Client,
    ErrorCode,
    ExchangeType,
    isClientError,
    resolveAttempt,
} from 'amqp-extension';
import type { ConsumeOptions, QueueOptions } from 'amqp-extension';
import {
    MessageRoutingType,
    invokeHook,
    isMessage,
    serializeMessage,
} from 'ergos';
import type {
    IMessageBusConsumer,
    IMessageBusDriver,
    Message,
    MessageHandler,
    MessageRouting,
} from 'ergos';
import type {
    AmqpMessageBusDriverHooks,
    AmqpMessageBusDriverOptions,
    IAmqpClient,
} from './types';

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

    protected hooks?: AmqpMessageBusDriverHooks;

    constructor(options: AmqpMessageBusDriverOptions) {
        this.options = options;
        this.hooks = options.hooks;
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

    async publish(routing: MessageRouting, message: Message): Promise<boolean> {
        // Resolves once the broker confirmed the message (a rejection throws);
        // amqplib's boolean only reports write-buffer backpressure.
        await this.resolveExchange(routing).publish(routing.key, serializeMessage(message), {
            type: message.type,
            messageId: message.id,
            persistent: message.metadata.persistent ?? routing.type === MessageRoutingType.WORK,
            ...this.resolveQueueOptions(routing),
        });

        return true;
    }

    async consume(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        const isWork = routing.type === MessageRoutingType.WORK;
        const options: ConsumeOptions = {
            prefetchCount: this.options.prefetchCount ?? 1,
            // reached only when a retry re-publish fails: the message comes back as a redelivery
            requeueOnFailure: isWork,
            ...this.resolveQueueOptions(routing),
        };
        if (isWork) {
            const maxAttempts = this.options.maxAttempts ?? 5;
            options.retry = { maxAttempts, delay: this.options.retryDelay ?? 1000 };
            // The handler's own error reaches MessageBus' onError hook first.
            // ponytail: a crashed redelivery's retries are not reported by amqp-extension, only its drop.
            options.onError = (error, input) => {
                const attempt = resolveAttempt(input.properties);
                if (isClientError(error) && error.code === ErrorCode.ATTEMPTS_EXHAUSTED) {
                    if (!this.hooks?.onDrop) return;

                    const message = this.decode(routing, input.content);
                    if (message) {
                        invokeHook(this.hooks, 'onDrop', {
                            message,
                            routing,
                            attempt,
                            error: error.cause,
                        });
                    }

                    return;
                }

                if (!this.hooks?.onRetry) return;

                const message = this.decode(routing, input.content);
                if (message) {
                    invokeHook(this.hooks, 'onRetry', {
                        message,
                        routing,
                        attempt,
                        error,
                    });
                }
            };
        }

        return this.resolveExchange(routing).consume(routing.key, options, {
            $any: async (input) => {
                const message = this.decode(routing, input.content);
                if (!message) {
                    return;
                }

                await handler(message);
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
     * The message in a delivery, or undefined (reported to onMalformed) when it is none.
     */
    protected decode(routing: MessageRouting, content: Uint8Array): Message | undefined {
        let value: unknown;
        try {
            value = JSON.parse(new TextDecoder().decode(content));
        } catch (error) {
            invokeHook(this.hooks, 'onMalformed', {
                routing, 
                content, 
                error, 
            });
            return undefined;
        }

        if (!isMessage(value)) {
            invokeHook(this.hooks, 'onMalformed', { routing, content });
            return undefined;
        }

        return value;
    }

    /**
     * Publisher and consumer must declare the queue identically (the broker
     * answers a mismatch with 406), so both sides derive it from the routing.
     */
    protected resolveQueueOptions(routing: MessageRouting): QueueOptions {
        return routing.ordered ? { singleActiveConsumer: true } : {};
    }

    protected resolveExchange(routing: MessageRouting): IAmqpClient {
        if (routing.type === MessageRoutingType.WORK) {
            return this.client.of({ type: ExchangeType.DIRECT, name: routing.namespace || '' });
        }

        return this.client.of({ type: ExchangeType.TOPIC, name: routing.namespace || this.options.defaultTopicExchange });
    }
}
