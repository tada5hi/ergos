import type { ObjectLiteral } from '../types';

export type ComponentMetadata = {
    correlationId?: string,
    [key: string]: unknown,
};

export type ComponentEventMapValue = [ObjectLiteral, ComponentMetadata];
export type ComponentEventMap = Record<string, ComponentEventMapValue>;

export type ComponentStatus = {
    /**
     * Epoch ms of the last pass / handled call that completed without error.
     */
    lastSuccessAt?: number,
    /**
     * Epoch ms the pass / call in flight started at.
     */
    runningSince?: number,
};

export type ComponentHandlerContext<
    EventMap extends ComponentEventMap = ComponentEventMap,
    K extends keyof EventMap & string = keyof EventMap & string,
> = {
    key: K,
    metadata: EventMap[K][1],
    handle<C extends keyof EventMap & string>(key: C, data: EventMap[C][0], metadata?: EventMap[C][1]): Promise<void>,
};

export type ComponentHandlerFn<
    EventMap extends ComponentEventMap = ComponentEventMap,
    K extends keyof EventMap & string = keyof EventMap & string,
> = (data: EventMap[K][0], context: ComponentHandlerContext<EventMap, K>) => Promise<void> | void;

export type ComponentHandler<
    EventMap extends ComponentEventMap = ComponentEventMap,
    K extends keyof EventMap & string = keyof EventMap & string,
> = {
    initialize?: () => Promise<void> | void,
    handle: ComponentHandlerFn<EventMap, K>,
};

export type ComponentHandleOptions<EventMap extends ComponentEventMap = ComponentEventMap> = {
    /**
     * Receives every event no handler (and no '*') accepted — the replies.
     */
    handle?(data: EventMap[keyof EventMap & string][0], context: ComponentHandlerContext<EventMap>): Promise<void> | void,
};

export interface IComponent<EventMap extends ComponentEventMap = ComponentEventMap> {
    start(): Promise<void>;
    stop(): Promise<void>;
    status(): ComponentStatus;
    /**
     * Resolves once no work started by this component is still running. Optional:
     * a shutdown over mixed components stops them all, then awaits `settled?.()`.
     */
    settled?(): Promise<void>;
    handle?<K extends keyof EventMap & string>(
        key: K,
        data: EventMap[K][0],
        metadata?: EventMap[K][1],
        options?: ComponentHandleOptions<EventMap>,
    ): Promise<void>;
}

/**
 * A component that can be called: an IComponent whose handle is not optional.
 * Component satisfies it.
 */
export interface ICallable<EventMap extends ComponentEventMap = ComponentEventMap> extends IComponent<EventMap> {
    handle: NonNullable<IComponent<EventMap>['handle']>;
}

/**
 * One event a component did not handle — a child event (a reply) or an
 * unknown top-level command — typed by key.
 */
export type ForwardedEvent<EventMap extends ComponentEventMap = ComponentEventMap> = {
    [K in keyof EventMap & string]: {
        key: K,
        data: EventMap[K][0],
        metadata: EventMap[K][1]
    }
}[keyof EventMap & string];

/**
 * Observers; a hook that throws is ignored (see invokeHook).
 */
export type ScheduledComponentHooks = {
    /**
     * A pass failed. start() still resolves; the next tick runs again.
     */
    onError?(error: unknown): void,
};

/**
 * A component that can be drained: an IComponent whose settled is not optional.
 */
export interface IScheduledComponent extends IComponent {
    /**
     * Resolves once no pass is running (at once when none is). stop() does not
     * wait for a pass in flight; a shutdown awaits settled() after stop().
     * A pass must never await its own component's settled(): it would wait for itself.
     */
    settled(): Promise<void>;
}

export type ScheduledComponentOptions = {
    /**
     * node-cron expression
     */
    schedule: string,
    run: () => Promise<void>,
    /**
     * Run one pass in start() before scheduling. Default: true
     */
    runOnStart?: boolean,
    hooks?: ScheduledComponentHooks,
};
