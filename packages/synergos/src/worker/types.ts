import type { ComponentEventMap, ForwardedEvent } from '../component';
import type { IMessageBus, Message, MessageRouting } from '../message-bus';

/**
 * Observers; a hook that throws is ignored (see invokeHook).
 */
export type RemoteWorkerHooks<EventMap extends ComponentEventMap = ComponentEventMap> = {
    /**
     * A forwarded event was dropped: no reply routing is set.
     */
    onUnrouted?(event: ForwardedEvent<EventMap>): void,
    /**
     * The bus resolved false for a forwarded event (memory driver); the command still settles.
     */
    onUndelivered?(message: Message): void,
};

export type RemoteWorkerOptions<EventMap extends ComponentEventMap = ComponentEventMap> = {
    messageBus: IMessageBus,
    consume: MessageRouting,
    /**
     * Where forwarded events are published. Unset: they are dropped and reported.
     */
    reply?: MessageRouting,
    hooks?: RemoteWorkerHooks<EventMap>,
};
