import type { ILogger } from '../types';
import type { ComponentEventMap, ComponentEventMapValue } from '../component';
import type { IMessageBus, MessageRouting } from '../message-bus';

export type CallerPayload<V extends ComponentEventMapValue = ComponentEventMapValue> = [
    data: V[0],
    metadata: V[1],
];

export interface ICaller<EventMap extends ComponentEventMap = ComponentEventMap> {
    call<K extends keyof EventMap & string>(key: K, ...payload: CallerPayload<EventMap[K]>): Promise<void>;
}

export type DirectCallerResponse<EventMap extends ComponentEventMap = ComponentEventMap> = {
    [K in keyof EventMap]?: EventMap[K][0]
};

export type DispatchCallerOptions = {
    routing: MessageRouting,
    /**
     * Debug-log each publish. Default: true
     */
    logging?: boolean,
    messageBus: IMessageBus,
    logger?: ILogger,
};

export type WorkerCallerOptions = {
    consumeRouting: MessageRouting,
    /**
     * Where unhandled child events (the replies) are published.
     */
    publishRouting?: MessageRouting,
    messageBus: IMessageBus,
    logger?: ILogger,
};
