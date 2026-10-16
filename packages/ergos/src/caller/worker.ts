import type { ILogger } from '../types';
import type {
    ComponentEventMap,
    ComponentStatus,
    IComponent,
} from '../component';
import type { IMessageBus, IMessageBusConsumer } from '../message-bus';
import { buildMessage } from '../message-bus';
import type {
    CallerPayload,
    ICaller,
    WorkerCallerOptions,
} from './types';

/**
 * Consumes a routing into a component and publishes the component's
 * unhandled child events (the replies) to `publishRouting`.
 */
export class WorkerCaller<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements ICaller<EventMap>, IComponent<EventMap> {
    protected component: IComponent<EventMap>;

    protected options: WorkerCallerOptions;

    protected messageBus: IMessageBus;

    protected logger?: ILogger;

    protected consumer?: IMessageBusConsumer;

    constructor(component: IComponent<EventMap>, options: WorkerCallerOptions) {
        this.component = component;
        this.options = options;
        this.messageBus = options.messageBus;
        this.logger = options.logger;
    }

    async start(): Promise<void> {
        await this.component.start();

        this.consumer = await this.messageBus.consumeAny(
            this.options.consumeRouting,
            // The wire can not vouch for the event map; an unknown type
            // resolves like any unhandled key (Component semantics).
            (message) => this.call(
                message.type as keyof EventMap & string,
                message.data as EventMap[keyof EventMap & string][0],
                message.metadata as EventMap[keyof EventMap & string][1],
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
        ...payload: CallerPayload<EventMap[K]>
    ): Promise<void> {
        const { component } = this;
        if (!component.handle) {
            throw new Error(`Component ${component.constructor.name} can not be called.`);
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
                // or an older consumer drops the reply early; the reply gets its own timestamp and
                // the persistence of its own routing, not the command's
                const metadata = { ...childContext.metadata };
                delete metadata.attempt;
                delete metadata.timestamp;
                delete metadata.persistent;
                await this.messageBus.publish(buildMessage({
                    type: childContext.key,
                    data: childData,
                    metadata: { ...metadata, routing: publishRouting },
                }));
            },
        });
    }
}
