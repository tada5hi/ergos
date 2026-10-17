import { Cron } from 'croner';
import { invokeHook } from '../hook';
import type { IScheduledComponent, ScheduledComponentOptions } from './types';

// the longest a timer waits before the loop looks at the clock again: keeps a far slot
// below setTimeout's 2^31-1 ms limit and re-evaluates a slot croner answered in the past
const RECHECK_MS = 30_000;

/**
 * A background job: one pass in start() (unless disabled), then one per cron
 * tick, never overlapping. A failing pass is reported to hooks.onError and never rejects —
 * start() is typically fire-and-forget, the next tick retries.
 * stop() does not wait for a pass in flight; a shutdown awaits settled() after stop().
 * A pass must never await its own component's settled() — it would deadlock.
 */
export function defineScheduledComponent(options: ScheduledComponentOptions): IScheduledComponent {
    // croner only evaluates the expression: it is never given a callback, so it arms no timer.
    // The loop below waits for each slot itself, so a pass knows the slot it runs for.
    let evaluator: Cron;
    try {
        evaluator = new Cron(options.schedule, { mode: '5-or-6-parts', paused: true });
    } catch {
        // fail at definition, not after a full pass in start()
        throw new Error(`Invalid cron expression: ${options.schedule}`);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let scheduled = false;
    // bumped by every start() and stop(): a start() whose first pass was
    // overtaken by either must not schedule afterwards
    let generation = 0;
    let lastSuccessAt: number | undefined;
    let runningSince: number | undefined;
    // the pass in flight: a start() during it (a second start(), or one after a stop())
    // joins it instead of running a second pass next to it
    let pass: Promise<void> | undefined;
    // epoch ms of the last tick's slot (or of the moment scheduling began): the next slot lies after it
    let last = 0;

    const run = async (scheduledAt: Date) => {
        runningSince = Date.now();
        try {
            await options.run({ scheduledAt });
            lastSuccessAt = Date.now();
        } catch (e) {
            invokeHook(options.hooks, 'onError', e);
        } finally {
            runningSince = undefined;
        }
    };

    const execute = (scheduledAt: Date) => {
        // cleared asynchronously: a run() that throws synchronously must not leave a settled pass behind
        pass ??= run(scheduledAt).finally(() => { pass = undefined; });
        return pass;
    };

    function arm() {
        const from = Math.max(Date.now(), last);
        const next = evaluator.nextRun(new Date(from));
        if (!next) {
            // the expression has no future run
            timer = undefined;
            return;
        }

        if (next.getTime() <= from) {
            // inside a repeated DST hour croner can answer with a past instant: look again later
            timer = setTimeout(arm, RECHECK_MS);
            return;
        }

        wait(next.getTime());
    }

    function wait(slot: number) {
        timer = setTimeout(() => {
            if (Date.now() < slot) {
                // a capped wait woke before the slot
                wait(slot);
                return;
            }

            last = slot;
            // re-arm before the pass: a pass that stops its own component clears this timer
            arm();
            void execute(new Date(slot));
        }, Math.min(slot - Date.now(), RECHECK_MS));
    }

    return {
        async start() {
            if (scheduled) {
                return;
            }

            const current = ++generation;
            if (options.runOnStart ?? true) {
                await execute(new Date());
            }

            if (current !== generation) {
                return;
            }

            scheduled = true;
            last = Date.now();
            arm();
        },
        async stop() {
            generation++;

            // does not wait for a pass in flight (a pass may stop its own component), see settled();
            // nothing is scheduled after it
            scheduled = false;
            clearTimeout(timer);
            timer = undefined;
        },
        async settled() {
            // ponytail: one pass at most; a pass started meanwhile (a start() after stop()) is not awaited
            await pass;
        },
        status: () => ({ lastSuccessAt, runningSince }),
    };
}
