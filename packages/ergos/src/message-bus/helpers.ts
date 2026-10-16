import type { ObjectLiteral } from '../types';
import type { Message, MessageInput } from './types';

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
