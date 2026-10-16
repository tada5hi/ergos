import type { ComponentEventMap, ICallable } from '../component';
import type {
    IDispatcher,
    LocalDispatchResult,
    LocalDispatcherOptions,
} from './types';
import { correlate } from './wire';

/**
 * Calls a component in-process and returns the events it forwarded.
 */
export class LocalDispatcher<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements IDispatcher<EventMap> {
    protected component: ICallable<EventMap>;

    protected options: LocalDispatcherOptions<EventMap>;

    constructor(component: ICallable<EventMap>, options: LocalDispatcherOptions<EventMap> = {}) {
        this.component = component;
        this.options = options;
    }

    async dispatch<K extends keyof EventMap & string>(
        key: K,
        data: EventMap[K][0],
        metadata?: EventMap[K][1],
    ): Promise<LocalDispatchResult<EventMap>> {
        const correlated = correlate(metadata);
        const replies: LocalDispatchResult<EventMap>['replies'] = [];

        await this.component.handle(key, data, correlated, {
            handle: async (childData, ctx) => {
                replies.push({
                    key: ctx.key,
                    data: childData,
                    metadata: ctx.metadata,
                });
                await this.options.reply?.handle(ctx.key, childData, ctx.metadata);
            },
        });

        return {
            correlationId: correlated.correlationId,
            replies,
        };
    }
}
