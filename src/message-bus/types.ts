import type { ObjectLiteral } from '../types';
import type { MessageBusRoutingType } from './constants';

export type MessageBusRouting = {
    type: `${MessageBusRoutingType}`,
    key: string,
    namespace?: string,
    /**
     * WORK only: deliver to one consumer at a time, in publish order, with
     * failover to another replica (AMQP single active consumer). For replies
     * whose handlers must not race each other across replicas.
     */
    ordered?: boolean,
};

export type MessageBusPayloadMetadata = {
    timestamp: number,
    persistent?: boolean,
    routing: MessageBusRouting,
};

export type MessageBusPublishOptions = {
    logging?: boolean,
};

export type MessageBusPayload<
    T = string,
    D = ObjectLiteral,
> = {
    id: string,
    type: T,
    data: D,
    metadata: MessageBusPayloadMetadata,
};

export type MessageBusPayloadMetadataInput = Partial<Pick<MessageBusPayloadMetadata, 'timestamp'>> &
    Omit<MessageBusPayloadMetadata, 'timestamp'>;

export type MessageBusPayloadInput<
    T = string,
    D = ObjectLiteral,
> = {
    id?: string,
    type: T,
    data?: D,
    metadata: MessageBusPayloadMetadataInput,
};

export type MessageBusHandler<
    T = string,
    D = ObjectLiteral,
> = (message: MessageBusPayload<T, D>) => Promise<void> | void;

export type MessageBusHandlers = {
    $any?: MessageBusHandler,
    [type: string]: MessageBusHandler | undefined,
};

export interface IMessageBusConsumer {
    /**
     * Stop receiving messages. Resolves once the handlers in flight settled.
     */
    cancel(): Promise<void>;
}

export interface IMessageBusDriver {
    /**
     * Resolves true once a consumer (memory) or the broker (amqp) accepted it.
     */
    publish(routing: MessageBusRouting, message: MessageBusPayload): Promise<boolean>;
    consume(routing: MessageBusRouting, handler: MessageBusHandler): Promise<IMessageBusConsumer>;
    close?(): Promise<void>;
}
