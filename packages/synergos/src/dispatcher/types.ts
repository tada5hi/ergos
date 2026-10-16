import type { ComponentEventMap, ForwardedEvent, ICallable } from '../component';
import type { IMessageBus, Message, MessageRouting } from '../message-bus';

export type DispatchResult = {
    correlationId: string,
    /**
     * The bus accepted the command (RemoteDispatcher), always true for LocalDispatcher.
     */
    delivered: boolean,
};

export interface IDispatcher<EventMap extends ComponentEventMap = ComponentEventMap> {
    dispatch<K extends keyof EventMap & string>(
        key: K,
        data: EventMap[K][0],
        metadata?: EventMap[K][1],
    ): Promise<DispatchResult>;
}

export type LocalDispatcherOptions<EventMap extends ComponentEventMap = ComponentEventMap> = {
    /**
     * Receives every forwarded event.
     */
    reply?: ICallable<EventMap>,
};

export type LocalDispatchResult<EventMap extends ComponentEventMap = ComponentEventMap> = DispatchResult & {
    /**
     * The forwarded events, in emission order.
     */
    replies: ForwardedEvent<EventMap>[],
};

/**
 * Observers; a hook that throws is ignored (see invokeHook).
 */
export type RemoteDispatcherHooks = {
    /**
     * The bus resolved false: no consumer accepted the command (memory driver).
     */
    onUndelivered?(message: Message): void,
};

export type RemoteDispatcherOptions = {
    messageBus: IMessageBus,
    routing: MessageRouting,
    hooks?: RemoteDispatcherHooks,
};
