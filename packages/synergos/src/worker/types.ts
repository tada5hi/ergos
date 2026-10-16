import type { ForwardedEvent } from '../component';
import type { IMessageBus, MessageRouting } from '../message-bus';

/**
 * Observers; a hook that throws is ignored (see invokeHook).
 */
export type RemoteWorkerHooks = {
    /**
     * A forwarded event was dropped: no `publish` routing is set. Untyped: an unknown
     * command from the wire is forwarded too.
     */
    onUnrouted?(event: ForwardedEvent): void,
};

export type RemoteWorkerOptions = {
    messageBus: IMessageBus,
    consume: MessageRouting,
    /**
     * Where forwarded events are published. Unset: they are dropped and reported.
     */
    publish?: MessageRouting,
    hooks?: RemoteWorkerHooks,
};
