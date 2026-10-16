import type { HookArgs } from './types';

/**
 * Call hooks[name] (with hooks as `this`), if set. Hooks observe and never change
 * an outcome: a hook that throws, or returns a promise that rejects, is ignored.
 * Every hook site can sit on a consume path (a handler that publishes, a reply),
 * where a propagated error would turn an ack into a retry.
 */
export function invokeHook<H extends object, K extends keyof H>(
    hooks: H | undefined,
    name: K,
    ...args: HookArgs<NonNullable<H[K]>>
): void {
    const hook = hooks?.[name];
    if (typeof hook !== 'function') {
        return;
    }

    try {
        const result: unknown = hook.apply(hooks, args);
        if (result instanceof Promise) {
            result.catch(() => {});
        }
    } catch {
        // see above: a failing hook must not change the outcome
    }
}
