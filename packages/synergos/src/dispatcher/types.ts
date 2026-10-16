import type { ComponentEventMap, ForwardedEvent, ICallable } from '../component';

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
