import type { ILogger } from '../types';
import type {
    ComponentEventMap,
    ComponentStatus,
    IComponent,
} from '../component';
import type { IMessageBusConsumer, MessageBus } from '../message-bus';
import { buildMessageBusPayload } from '../message-bus';
import type {
    ComponentCallerPayload,
    IComponentCaller,
    MessageBusWorkerComponentCallerOptions,
} from './types';

/**
 * Consumes a routing into a component and publishes the component's
 * unhandled child events (the replies) to `publishRouting`.
 */
export class MessageBusWorkerComponentCaller<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements IComponentCaller<EventMap>, IComponent<EventMap> {
    protected component: IComponent<EventMap>;

    protected options: MessageBusWorkerComponentCallerOptions;

    protected messageBus?: MessageBus;

    protected logger?: ILogger;

    protected consumer?: IMessageBusConsumer;

    constructor(component: IComponent<EventMap>, options: MessageBusWorkerComponentCallerOptions) {
        this.component = component;
        this.options = options;
        this.messageBus = options.messageBus;
        this.logger = options.logger;
    }

    async start(): Promise<void> {
        await this.component.start();

        if (!this.messageBus) {
            this.logger?.warn(`Can not consume queue for component ${this.component.constructor.name}`);
            return;
        }

        this.consumer = await this.messageBus.consumeAny(
            this.options.consumeRouting,
            // The wire can not vouch for the event map; an unknown type
            // resolves like any unhandled key (Component semantics).
            (payload) => this.call(
                payload.type as keyof EventMap & string,
                payload.data as EventMap[keyof EventMap & string][0],
                payload.metadata as EventMap[keyof EventMap & string][1],
            ),
        );
    }

    /**
     * Cancel the consumer — which waits for the handler in flight — then
     * stop the component.
     */
    async stop(): Promise<void> {
        const { consumer } = this;
        this.consumer = undefined;
        await consumer?.cancel();

        await this.component.stop();
    }

    status(): ComponentStatus {
        return this.component.status();
    }

    async call<K extends keyof EventMap & string>(
        key: K,
        ...payload: ComponentCallerPayload<EventMap[K]>
    ): Promise<void> {
        const { component } = this;
        if (!component.handle) {
            throw new Error(`Component ${component.constructor.name} can not be called.`);
        }

        const { messageBus } = this;
        if (!messageBus) {
            throw new Error(`MessageBus is not available for component ${component.constructor.name}.`);
        }

        await component.handle(key, payload[0], payload[1], {
            handle: async (childData, childContext) => {
                const { publishRouting } = this.options;
                if (!publishRouting) {
                    this.logger?.warn(
                        `Component ${component.constructor.name} event ${childContext.key} could not be handled.`,
                    );
                    return;
                }

                // an older producer's retry counter (body metadata.attempt) must not leak into the reply,
                // or an older consumer drops the reply early
                const metadata = { ...childContext.metadata };
                delete metadata.attempt;
                await messageBus.publish(buildMessageBusPayload({
                    type: childContext.key,
                    data: childData,
                    metadata: { ...metadata, routing: publishRouting },
                }));
            },
        });
    }
}
