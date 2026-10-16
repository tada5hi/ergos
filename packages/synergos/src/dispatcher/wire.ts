import type { ComponentEventMap, ComponentMetadata, ForwardedEvent } from '../component';
import type { Message, MessageRouting } from '../message-bus';
import { buildMessage } from '../message-bus';
import type { ObjectLiteral } from '../types';

/**
 * Keep a non-empty correlationId, else generate one.
 */
export function correlate<M extends ComponentMetadata>(metadata?: M): M & { correlationId: string } {
    return { ...metadata as M, correlationId: metadata?.correlationId || crypto.randomUUID() };
}

export function toMessage(
    key: string,
    data: ObjectLiteral,
    metadata: ComponentMetadata,
    routing: MessageRouting,
): Message {
    return buildMessage({
        type: key,
        data,
        metadata: { ...metadata, routing },
    });
}

/**
 * A forwarded event gets its own timestamp and the persistence of its own
 * routing, not the command's; a delivery attempt never leaks into it.
 */
export function toForwardedMessage(event: ForwardedEvent, routing: MessageRouting): Message {
    const metadata = { ...event.metadata };
    delete metadata.attempt;
    delete metadata.timestamp;
    delete metadata.persistent;
    delete metadata.routing;

    return toMessage(event.key, event.data, metadata, routing);
}

/**
 * The wire can not vouch for the event map; an unknown type resolves like
 * any unhandled key (Component semantics).
 */
export function fromMessage<EventMap extends ComponentEventMap = ComponentEventMap>(
    message: Message,
): ForwardedEvent<EventMap> {
    return {
        key: message.type,
        data: message.data,
        metadata: message.metadata,
    } as ForwardedEvent<EventMap>;
}
