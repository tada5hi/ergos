import type {
    ComponentEventMap,
    ComponentStatus,
    ICallable,
    IComponent,
} from '../component';
import { createLifecycle } from './lifecycle';
import { fromMessage, toForwardedMessage } from '../dispatcher/wire';
import { invokeHook } from '../hook';
import type { Message } from '../message-bus';
import type { RemoteWorkerOptions } from './types';

/**
 * Consumes a routing into a component and publishes its forwarded events to `publish`.
 */
export class RemoteWorker<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements IComponent<EventMap> {
    protected component: ICallable<EventMap>;

    protected options: RemoteWorkerOptions;

    protected lifecycle: ReturnType<typeof createLifecycle>;

    constructor(component: ICallable<EventMap>, options: RemoteWorkerOptions) {
        this.component = component;
        this.options = options;
        this.lifecycle = createLifecycle(async () => {
            await component.start();

            let consumer;
            try {
                consumer = await options.messageBus.consumeAny(options.consume, (message) => this.consume(message));
            } catch (e) {
                await component.stop().catch(() => {});
                throw e;
            }

            // cancel() waits for the handler in flight
            return async () => {
                try {
                    await consumer.cancel();
                } finally {
                    await component.stop();
                }
            };
        });
    }

    start(): Promise<void> {
        return this.lifecycle.start();
    }

    stop(): Promise<void> {
        return this.lifecycle.stop();
    }

    status(): ComponentStatus {
        return this.component.status();
    }

    protected async consume(message: Message): Promise<void> {
        const {
            messageBus, 
            publish, 
            hooks, 
        } = this.options;
        const event = fromMessage<EventMap>(message);

        await this.component.handle(event.key, event.data, event.metadata, {
            handle: async (data, ctx) => {
                const forwarded = {
                    key: ctx.key,
                    data,
                    metadata: ctx.metadata,
                };
                if (!publish) {
                    invokeHook(hooks, 'onUnrouted', forwarded);
                    return;
                }

                await messageBus.publish(toForwardedMessage(forwarded, publish));
            },
        });
    }
}
