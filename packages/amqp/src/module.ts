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
} from 'synergos';
import type {
    IMessageBusConsumer,
    IMessageBusDriver,
    Message,
    MessageHandler,
    MessageRouting,
} from 'synergos';
import type {
    AmqpMessageBusDriverHooks,
    AmqpMessageBusDriverOptions,
    IAmqpClient,
} from './types';

/**
 * Maps the message bus onto amqp-extension. WORK routings go through the default
 * (direct) exchange, a namespaced one through a topic exchange into the shared queue
 * `key`, and are retried by amqp-extension (x-attempt header, backoff, redelivery
 * guard); PUB_SUB routings go through a topic exchange and are not retried,
 * unless consumed through a named, durable `queue`, which is retried like WORK.
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

    async publish(routing: MessageRouting, message: Message): Promise<void> {
        // Resolves once the broker confirmed the message (a rejection throws);
        // amqplib's boolean only reports write-buffer backpressure.
        await this.resolveExchange(routing).publish(routing.key, serializeMessage(message), {
            type: message.type,
            messageId: message.id,
            persistent: message.metadata.persistent ?? routing.persistent ?? routing.type === MessageRoutingType.WORK,
            // per-message TTL: the broker drops it; MessageBus drops one that still arrives late
            ...(message.metadata.expiresAt === undefined ?
                {} :
                { expiration: String(Math.max(0, Math.ceil(message.metadata.expiresAt - Date.now()))) }),
            ...this.resolveQueueOptions(routing),
        });
    }

    async consume(routing: MessageRouting, handler: MessageHandler): Promise<IMessageBusConsumer> {
        // a PUB_SUB queue is durable and shared, so it must not lose a failed message either
        const isWork = routing.type === MessageRoutingType.WORK;
        const isRetried = isWork || !!routing.queue;
        const queue = isWork ? routing.namespace && routing.key : routing.queue;
        const maxAttempts = isRetried ? this.options.maxAttempts ?? 5 : 1;
        const options: ConsumeOptions = {
            prefetchCount: this.options.prefetchCount ?? 1,
            // reached only when a retry re-publish fails: the message comes back as a redelivery
            requeueOnFailure: isRetried,
            ...this.resolveQueueOptions(routing),
            // only the consumer declares it: a topic publish declares no queue, so no 406
            // ponytail: so a namespaced WORK message published before the first consume is unroutable (dropped)
            ...(queue ? { queue } : {}),
        };
        if (isRetried) {
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

                // amqp-extension counts attempts in the x-attempt header, not in the body
                message.metadata.delivery = {
                    attempt: isRetried ? resolveAttempt(input.properties) : 1,
                    maxAttempts,
                };

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
        if (routing.type === MessageRoutingType.WORK && !routing.namespace) {
            return this.client.of({ type: ExchangeType.DIRECT, name: '' });
        }

        // amqp-extension takes any direct exchange for the default one (no declare, no bind),
        // so a namespaced WORK routing is a topic exchange; its consumers share the queue `key`.
        // ponytail: a key with `*` / `#` is a topic pattern, and a PUB_SUB publish on the namespace reaches it.

        return this.client.of({ type: ExchangeType.TOPIC, name: routing.namespace || this.options.defaultTopicExchange });
    }
}
