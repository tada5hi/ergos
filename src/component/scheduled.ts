import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import type { IComponent, ScheduledComponentOptions } from './types';

/**
 * A background job: one pass in start() (unless disabled), then one per cron
 * tick, never overlapping. A failing pass is logged and never rejects —
 * start() is typically fire-and-forget, the next tick retries.
 */
export function defineScheduledComponent(options: ScheduledComponentOptions): IComponent {
    let task: ScheduledTask | undefined;
    // bumped by every start() and stop(): a start() whose first pass was
    // overtaken by either must not schedule afterwards
    let generation = 0;
    let lastSuccessAt: number | undefined;
    let runningSince: number | undefined;

    const execute = async () => {
        runningSince = Date.now();
        try {
            await options.run();
            lastSuccessAt = Date.now();
        } catch (e) {
            options.logger?.warn(`Component ${options.name ?? 'scheduled'} pass failed.`);
            options.logger?.warn(e);
        } finally {
            runningSince = undefined;
        }
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
            // ponytail: does not wait for a pass in flight; nothing is scheduled after it
            await current?.stop();
        },
        status: () => ({ lastSuccessAt, runningSince }),
    };
}
