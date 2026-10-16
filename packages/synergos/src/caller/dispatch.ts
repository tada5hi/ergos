import type { ComponentEventMap, ComponentMetadata } from '../component';
import { invokeHook } from '../hook';
import type { IMessageBus } from '../message-bus';
import { buildMessage } from '../message-bus';
import type { ObjectLiteral } from '../types';
import type {
    CallerPayload,
    DispatchCallerOptions,
    ICaller,
} from './types';

/**
 * Publishes a command to a routing; a worker caller elsewhere handles it.
 */
export class DispatchCaller<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements ICaller<EventMap> {
    protected options: DispatchCallerOptions;

    protected messageBus: IMessageBus;

    constructor(options: DispatchCallerOptions) {
        this.options = options;
        this.messageBus = options.messageBus;
    }

    call<K extends keyof EventMap & string>(key: K, ...payload: CallerPayload<EventMap[K]>): Promise<void>;

    async call(type: string, data: ObjectLiteral, metadata: ComponentMetadata): Promise<void> {
        const message = buildMessage({
            type,
            data,
            metadata: { ...metadata, routing: this.options.routing },
        });

        const published = await this.messageBus.publish(message);
        if (!published) {
            invokeHook(this.options.hooks, 'onUndelivered', message);
        }
    }
}
