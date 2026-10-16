import type {
    ComponentEventMap,
    ComponentEventMapValue,
    ComponentMetadata,
} from '../component';
import type { IMessageBus, Message, MessageRouting } from '../message-bus';
import type { ObjectLiteral } from '../types';

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

/**
 * Observers; a hook that throws is ignored (see invokeHook).
 */
export type DispatchCallerHooks = {
    /**
     * The bus resolved false: no consumer accepted the command (memory driver).
     */
    onUndelivered?(message: Message): void,
};

export type DispatchCallerOptions = {
    routing: MessageRouting,
    messageBus: IMessageBus,
    hooks?: DispatchCallerHooks,
};

/**
 * Observers; a hook that throws is ignored (see invokeHook).
 */
export type WorkerCallerHooks = {
    /**
     * A child event (a reply) was dropped: no publishRouting is set.
     */
    onUnrouted?(key: string, data: ObjectLiteral, metadata: ComponentMetadata): void,
};

export type WorkerCallerOptions = {
    consumeRouting: MessageRouting,
    /**
     * Where unhandled child events (the replies) are published.
     */
    publishRouting?: MessageRouting,
    messageBus: IMessageBus,
    hooks?: WorkerCallerHooks,
};
