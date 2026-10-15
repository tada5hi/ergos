import type {
    ComponentEventMap,
    ComponentHandleOptions,
    IComponent,
} from '../component';
import type { ComponentCallerPayload, ComponentDirectCallerResponse, IComponentCaller } from './types';

/**
 * Calls a component in-process.
 */
export class DirectComponentCaller<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements IComponentCaller<EventMap> {
    protected component: IComponent<EventMap>;

    constructor(component: IComponent<EventMap>) {
        this.component = component;
    }

    async call<K extends keyof EventMap & string>(
        key: K,
        ...payload: ComponentCallerPayload<EventMap[K]>
    ): Promise<void> {
        await this.callAndWait(key, ...payload);
    }

    async callWith<K extends keyof EventMap & string>(
        key: K,
        data: EventMap[K][0],
        metadata: EventMap[K][1],
        options: ComponentHandleOptions<EventMap>,
    ): Promise<void> {
        const { component } = this;
        if (!component.handle) {
            throw new Error(`Component ${component.constructor.name} can not be called.`);
        }

        await component.handle(
            key,
            data,
            { ...metadata, correlationId: metadata.correlationId || crypto.randomUUID() },
            options,
        );
    }

    /**
     * Call a handler and collect the events nobody handled (the replies), by key.
     */
    async callAndWait<K extends keyof EventMap & string>(
        key: K,
        ...payload: ComponentCallerPayload<EventMap[K]>
    ): Promise<ComponentDirectCallerResponse<EventMap>> {
        const events: ComponentDirectCallerResponse<EventMap> = {};

        await this.callWith(key, payload[0], payload[1], {
            handle: (childData, childContext) => {
                events[childContext.key] = childData;
            },
        });

        return events;
    }
}
