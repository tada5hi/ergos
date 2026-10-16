import type { ComponentEventMap } from '../component';
import { invokeHook } from '../hook';
import type {
    DispatchResult,
    IDispatcher,
    RemoteDispatcherOptions,
} from './types';
import { correlate, toMessage } from './wire';

/**
 * Publishes a command to a routing; a remote worker elsewhere handles it.
 */
export class RemoteDispatcher<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements IDispatcher<EventMap> {
    protected options: RemoteDispatcherOptions;

    constructor(options: RemoteDispatcherOptions) {
        this.options = options;
    }

    async dispatch<K extends keyof EventMap & string>(
        key: K,
        data: EventMap[K][0],
        metadata?: EventMap[K][1],
    ): Promise<DispatchResult> {
        const correlated = correlate(metadata);
        const message = toMessage(key, data, correlated, this.options.routing);

        const delivered = await this.options.messageBus.publish(message);
        if (!delivered) {
            invokeHook(this.options.hooks, 'onUndelivered', message);
        }

        return { correlationId: correlated.correlationId, delivered };
    }
}
