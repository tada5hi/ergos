import type {
    ComponentEventMap,
    ComponentStatus,
    ICallable,
    IComponent,
} from '../component';
import { createLifecycle } from '../component/lifecycle';
import { fromMessage, toForwardedMessage } from '../dispatcher/wire';
import { invokeHook } from '../hook';
import type { Message } from '../message-bus';
import type { RemoteWorkerOptions } from './types';

/**
 * Consumes a routing into a component and publishes its forwarded events to `reply`.
 */
export class RemoteWorker<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements IComponent<EventMap> {
    protected component: ICallable<EventMap>;

    protected options: RemoteWorkerOptions<EventMap>;

    protected lifecycle: ReturnType<typeof createLifecycle>;

    constructor(component: ICallable<EventMap>, options: RemoteWorkerOptions<EventMap>) {
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
                await consumer.cancel();
                await component.stop();
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
            reply, 
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
                if (!reply) {
                    invokeHook(hooks, 'onUnrouted', forwarded);
                    return;
                }

                // the command still settles: a retry would re-run its side effects for a reply-only problem
                const forwardedMessage = toForwardedMessage(forwarded, reply);
                if (!await messageBus.publish(forwardedMessage)) {
                    invokeHook(hooks, 'onUndelivered', forwardedMessage);
                }
            },
        });
    }
}
