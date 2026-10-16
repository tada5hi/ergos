import type { ILogger, ObjectLiteral } from '../types';
import type { ComponentEventMap, ComponentMetadata } from '../component';
import type { MessageBus } from '../message-bus';
import { buildMessageBusPayload } from '../message-bus';
import type {
    ComponentCallerPayload,
    IComponentCaller,
    MessageBusDispatchComponentCallerOptions,
} from './types';

/**
 * Publishes a command to a routing; a worker caller elsewhere handles it.
 */
export class MessageBusDispatchComponentCaller<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements IComponentCaller<EventMap> {
    protected options: MessageBusDispatchComponentCallerOptions;

    protected messageBus?: MessageBus;

    protected logger?: ILogger;

    constructor(options: MessageBusDispatchComponentCallerOptions) {
        this.options = options;
        this.messageBus = options.messageBus;
        this.logger = options.logger;
    }

    call<K extends keyof EventMap & string>(key: K, ...payload: ComponentCallerPayload<EventMap[K]>): Promise<void>;

    async call(type: string, data: ObjectLiteral, metadata: ComponentMetadata): Promise<void> {
        if (!this.messageBus) {
            this.logger?.warn(`Can not publish ${type} event.`);
            return;
        }

        const published = await this.messageBus.publish(
            buildMessageBusPayload({
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
