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

/**
 * The transport owns attempt, timestamp and routing: a command re-dispatched with an inbound
 * ctx.metadata must not inherit them. A caller-given persistent is kept.
 */
export function toMessage(
    key: string,
    data: ObjectLiteral,
    metadata: ComponentMetadata,
    routing: MessageRouting,
): Message {
    const rest = { ...metadata };
    delete rest.attempt;
    delete rest.timestamp;

    // routing is overwritten in place, not deleted: the key order stays hub's
    return buildMessage({
        type: key,
        data,
        metadata: { ...rest, routing },
    });
}

/**
 * A forwarded event gets the persistence of its own routing, not the command's.
 */
export function toForwardedMessage(event: ForwardedEvent, routing: MessageRouting): Message {
    const metadata = { ...event.metadata };
    delete metadata.persistent;

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
