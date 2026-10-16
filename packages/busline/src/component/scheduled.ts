import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { invokeHook } from '../hook';
import type { IScheduledComponent, ScheduledComponentOptions } from './types';

/**
 * A background job: one pass in start() (unless disabled), then one per cron
 * tick, never overlapping. A failing pass is reported to hooks.onError and never rejects —
 * start() is typically fire-and-forget, the next tick retries.
 * stop() does not wait for a pass in flight; a shutdown awaits settled() after stop().
 * A pass must never await its own component's settled() — it would deadlock.
 */
export function defineScheduledComponent(options: ScheduledComponentOptions): IScheduledComponent {
    // fail at definition, not after a full pass in start()
    if (!cron.validate(options.schedule)) {
        throw new Error(`Invalid cron expression: ${options.schedule}`);
    }

    let task: ScheduledTask | undefined;
    // bumped by every start() and stop(): a start() whose first pass was
    // overtaken by either must not schedule afterwards
    let generation = 0;
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

    return {
        async start() {
            if (task) {
                return;
            }

            const current = ++generation;
            if (options.runOnStart ?? true) {
                await execute();
            }

            if (current !== generation) {
                return;
            }

            task = cron.schedule(options.schedule, execute, { noOverlap: true });
        },
        async stop() {
            generation++;

            const current = task;
            task = undefined;
            // does not wait for a pass in flight (a pass may stop its own component), see settled();
            // nothing is scheduled after it
            // destroy, not stop: a stopped task stays in node-cron's registry
            await current?.destroy();
        },
        async settled() {
            // ponytail: one pass at most; a pass started meanwhile (a start() after stop()) is not awaited
            await pass;
        },
        status: () => ({ lastSuccessAt, runningSince }),
    };
}
