import type { ILogger } from '../types';
import type { ComponentEventMap, ComponentEventMapValue } from '../component';
import type { MessageBus, MessageBusRouting } from '../message-bus';

export type ComponentCallerPayload<V extends ComponentEventMapValue = ComponentEventMapValue> = [
    data: V[0],
    metadata: V[1],
];

export interface IComponentCaller<EventMap extends ComponentEventMap = ComponentEventMap> {
    call<K extends keyof EventMap & string>(key: K, ...payload: ComponentCallerPayload<EventMap[K]>): Promise<void>;
}

export type ComponentDirectCallerResponse<EventMap extends ComponentEventMap = ComponentEventMap> = {
    [K in keyof EventMap]?: EventMap[K][0]
};

export type MessageBusDispatchComponentCallerOptions = {
    routing: MessageBusRouting,
    /**
     * Debug-log each publish. Default: true
     */
    logging?: boolean,
    messageBus?: MessageBus,
    logger?: ILogger,
};

export type MessageBusWorkerComponentCallerOptions = {
    consumeRouting: MessageBusRouting,
    /**
     * Where unhandled child events (the replies) are published.
     */
    publishRouting?: MessageBusRouting,
    messageBus?: MessageBus,
    logger?: ILogger,
};
