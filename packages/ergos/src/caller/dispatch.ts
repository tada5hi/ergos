import type { ILogger, ObjectLiteral } from '../types';
import type { ComponentEventMap, ComponentMetadata } from '../component';
import type { IMessageBus } from '../message-bus';
import { buildMessage } from '../message-bus';
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

    protected logger?: ILogger;

    constructor(options: DispatchCallerOptions) {
        this.options = options;
        this.messageBus = options.messageBus;
        this.logger = options.logger;
    }

    call<K extends keyof EventMap & string>(key: K, ...payload: CallerPayload<EventMap[K]>): Promise<void>;

    async call(type: string, data: ObjectLiteral, metadata: ComponentMetadata): Promise<void> {
        const published = await this.messageBus.publish(
            buildMessage({
                type,
                data,
                metadata: { ...metadata, routing: this.options.routing },
            }),
            { logging: this.options.logging ?? true },
        );

        if (!published) {
            this.logger?.warn(`Message ${type} in ${this.options.routing.key} was not delivered to any consumer.`);
        }
    }
}
