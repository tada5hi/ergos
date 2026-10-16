import type { ObjectLiteral } from '../types';
import { MessageRoutingType } from './constants';
import type { Message, MessageInput, MessageRouting } from './types';

/**
 * Throws a TypeError for a routing no driver may accept. A WORK namespace must not
 * contain '/': amqp names the queue `namespace/key`, so 'a/b' + 'c' and 'a' + 'b/c'
 * would share one queue.
 */
export function assertMessageRouting(routing: MessageRouting): void {
    if (routing.type === MessageRoutingType.WORK && routing.namespace?.includes('/')) {
        throw new TypeError(`The namespace of a work routing must not contain '/': ${routing.namespace}`);
    }
}

function isObject(input: unknown): input is ObjectLiteral {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

export function buildMessage(input: MessageInput): Message {
    // timestamp stays the first key: the JSON body must match hub's byte for byte
    const { timestamp, ...metadata } = input.metadata;

    return {
        id: input.id || crypto.randomUUID(),
        type: input.type,
        data: input.data || {},
        metadata: {
            timestamp: timestamp ?? Date.now(),
            ...metadata,
        },
    };
}

export function isMessage(input: unknown): input is Message {
    return isObject(input) &&
        typeof input.id === 'string' &&
        typeof input.type === 'string' &&
        isObject(input.data) &&
        isObject(input.metadata);
}

/**
 * JSON with Errors kept as { name, message, code? } — JSON.stringify turns
 * an Error into {}.
 */
export function serializeMessage(message: Message): string {
    return JSON.stringify(message, (_key, value: unknown) => {
        if (value instanceof Error) {
            return {
                name: value.name,
                message: value.message,
                ...('code' in value ? { code: value.code } : {}),
            };
        }

        return value;
    });
}
