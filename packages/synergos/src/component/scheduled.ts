import cron from 'node-cron';
import { invokeHook } from '../hook';
import { createLifecycle } from './lifecycle';
import type { IComponent, ScheduledComponentOptions } from './types';

/**
 * A background job: one pass in start() (unless disabled), then one per cron
 * tick, never overlapping. A failing pass is reported to hooks.onError and never rejects —
 * start() is typically fire-and-forget, the next tick retries.
 */
export function defineScheduledComponent(options: ScheduledComponentOptions): IComponent {
    let lastSuccessAt: number | undefined;
    let runningSince: number | undefined;
    // the pass in flight: a start() during it (a second start(), or one after a stop())
    // joins it instead of running a second pass next to it
    let pass: Promise<void> | undefined;

    const run = async () => {
        runningSince = Date.now();
        try {
            await options.run();
            lastSuccessAt = Date.now();
        } catch (e) {
            invokeHook(options.hooks, 'onError', e);
        } finally {
            runningSince = undefined;
        }
    };

    const execute = () => {
        // cleared asynchronously: a run() that throws synchronously must not leave a settled pass behind
        pass ??= run().finally(() => { pass = undefined; });
        return pass;
    };

    const { start, stop } = createLifecycle(async () => {
        if (options.runOnStart ?? true) {
            await execute();
        }

        const task = cron.schedule(options.schedule, execute, { noOverlap: true });
        // ponytail: stop() waits for the first pass only, not for a later tick's pass in flight
        return async () => { await task.stop(); };
    });

    return {
        start,
        stop,
        status: () => ({ lastSuccessAt, runningSince }),
    };
}
