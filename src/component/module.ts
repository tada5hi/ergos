import type { ObjectLiteral } from '../types';
import type {
    ComponentEventMap,
    ComponentHandleOptions,
    ComponentHandler,
    ComponentHandlerContext,
    ComponentHandlerFn,
    ComponentMetadata,
    ComponentStatus,
    IComponent,
} from './types';

/**
 * Handlers are stored and dispatched untyped: the event map only types the
 * public overloads, the key arriving at runtime (e.g. from a bus) is a string.
 * Method syntax makes the parameters bivariant, which is what lets a handler
 * typed for one key be stored here without a cast.
 */
type AnyHandlerFn = {
    fn(data: ObjectLiteral, context: ComponentHandlerContext): Promise<void> | void,
}['fn'];
type AnyHandler = AnyHandlerFn | { initialize?: () => Promise<void> | void, handle: AnyHandlerFn };
type AnyHandleOptions = { handle?: AnyHandlerFn };

export class Component<
    EventMap extends ComponentEventMap = ComponentEventMap,
> implements IComponent<EventMap> {
    protected handlers = new Map<string, AnyHandler>();

    protected initializePromise: Promise<void> | undefined;

    protected running = 0;

    protected runningSince: number | undefined;

    protected lastSuccessAt: number | undefined;

    /**
     * Acquire background work (consumers, schedules). Nothing by default.
     */
    start(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Release what start() acquired. Nothing by default.
     */
    stop(): Promise<void> {
        return Promise.resolve();
    }

    status(): ComponentStatus {
        return { lastSuccessAt: this.lastSuccessAt, runningSince: this.runningSince };
    }

    mount<K extends keyof EventMap & string>(
        key: K,
        fn: ComponentHandler<EventMap, K> | ComponentHandlerFn<EventMap, K>,
    ): void;

    mount(key: '*', fn: ComponentHandler<EventMap> | ComponentHandlerFn<EventMap>): void;

    mount(key: string, fn: AnyHandler): void {
        this.handlers.set(key, fn);
    }

    unmount(key: keyof EventMap & string | '*'): void {
        this.handlers.delete(key);
    }

    /**
     * Run every handler's initialize() once. A failed attempt is forgotten,
     * so the next call retries.
     */
    initialize(): Promise<void> {
        if (!this.initializePromise) {
            const promises = this.handlers.values().toArray().map((handler) => Promise.resolve()
                .then(() => (typeof handler === 'function' ? undefined : handler.initialize?.())));

            const promise = Promise.all(promises).then(() => undefined);
            promise.catch(() => {
                if (this.initializePromise === promise) {
                    this.initializePromise = undefined;
                }
            });

            this.initializePromise = promise;
        }

        return this.initializePromise;
    }

    /**
     * Handle a top-level event. Child events emitted through
     * `context.handle` do not touch the status bookkeeping.
     */
    handle<K extends keyof EventMap & string>(
        key: K,
        data: EventMap[K][0],
        metadata?: EventMap[K][1],
        options?: ComponentHandleOptions<EventMap>,
    ): Promise<void>;

    async handle(
        key: string,
        data: ObjectLiteral,
        metadata: ComponentMetadata = {},
        options: AnyHandleOptions = {},
    ): Promise<void> {
        this.running++;
        this.runningSince ??= Date.now();

        try {
            await this.dispatch(key, data, metadata, options);
            this.lastSuccessAt = Date.now();
        } finally {
            this.running--;
            if (this.running === 0) {
                this.runningSince = undefined;
            }
        }
    }

    protected async dispatch(
        key: string,
        data: ObjectLiteral,
        metadata: ComponentMetadata,
        options: AnyHandleOptions,
    ): Promise<void> {
        await this.initialize();

        const context: ComponentHandlerContext = {
            key,
            metadata,
            handle: (childKey, childData, childMetadata) => this.dispatch(
                childKey,
                childData,
                { ...metadata, ...childMetadata },
                options,
            ),
        };

        const handler = this.handlers.get(key) ?? this.handlers.get('*') ?? options.handle;
        if (!handler) {
            return;
        }

        if (typeof handler === 'function') {
            await handler(data, context);
            return;
        }

        await handler.handle(data, context);
    }
}
