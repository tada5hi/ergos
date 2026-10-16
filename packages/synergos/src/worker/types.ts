import type { ForwardedEvent } from '../component';
import type { IMessageBus, Message, MessageRouting } from '../message-bus';

/**
 * Observers; a hook that throws is ignored (see invokeHook).
 */
export type RemoteWorkerHooks = {
    /**
     * A forwarded event was dropped: no reply routing is set. Untyped: an unknown
     * command from the wire is forwarded too.
     */
    onUnrouted?(event: ForwardedEvent): void,
    /**
     * The bus resolved false for a forwarded event (memory driver); the command still settles.
     */
    onUndelivered?(message: Message): void,
};

export type RemoteWorkerOptions = {
    messageBus: IMessageBus,
    consume: MessageRouting,
    /**
     * Where forwarded events are published. Unset: they are dropped and reported.
     */
    reply?: MessageRouting,
    hooks?: RemoteWorkerHooks,
};
