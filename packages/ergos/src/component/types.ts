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
    handle?<K extends keyof EventMap & string>(
        key: K,
        data: EventMap[K][0],
        metadata?: EventMap[K][1],
        options?: ComponentHandleOptions<EventMap>,
    ): Promise<void>;
}

/**
 * Observers; a hook that throws is ignored (see invokeHook).
 */
export type ScheduledComponentHooks = {
    /**
     * A pass failed. start() still resolves; the next tick runs again.
     */
    onError?(error: unknown): void,
};

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
