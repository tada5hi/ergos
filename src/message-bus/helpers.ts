import type { ObjectLiteral } from '../types';
import type { MessageBusPayload, MessageBusPayloadInput } from './types';

function isObject(input: unknown): input is ObjectLiteral {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

export function buildMessageBusPayload(input: MessageBusPayloadInput): MessageBusPayload {
    return {
        id: input.id || crypto.randomUUID(),
        type: input.type,
        data: input.data || {},
        metadata: {
            timestamp: Date.now(),
            ...input.metadata,
        },
    };
}

export function isMessageBusPayload(input: unknown): input is MessageBusPayload {
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
export function serializeMessageBusPayload(payload: MessageBusPayload): string {
    return JSON.stringify(payload, (_key, value: unknown) => {
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
