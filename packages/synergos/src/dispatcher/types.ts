import type { ComponentEventMap, ForwardedEvent, ICallable } from '../component';
import type { IMessageBus, MessageRouting } from '../message-bus';

export type DispatchResult = {
    correlationId: string,
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

export type RemoteDispatcherOptions = {
    messageBus: IMessageBus,
    routing: MessageRouting,
};
