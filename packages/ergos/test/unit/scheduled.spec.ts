import { describe, expect, it } from 'vitest';
import { defineScheduledComponent } from '../../src';
import { FakeLogger } from './fakes/logger';

const wait = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('src/component/scheduled', () => {
    it('should never reject start() when the first pass fails, and log it', async () => {
        const logger = new FakeLogger();
        const c = defineScheduledComponent({
            name: 'sweeper',
            schedule: '0 0 1 1 *',
            logger,
            run: async () => { throw new Error('x'); },
        });
        await expect(c.start()).resolves.toBeUndefined();
        expect(c.status().lastSuccessAt).toBeUndefined();
        expect(c.status().runningSince).toBeUndefined();
        expect(logger.calls.map((call) => call.level)).toEqual(['warn', 'warn']);
        expect(logger.calls[0]?.message).toContain('sweeper');
        await c.stop();
    });

    it('should not schedule when stopped during the first pass', async () => {
        const firstPass = Promise.withResolvers<void>();
        let passes = 0;
        const c = defineScheduledComponent({
            schedule: '* * * * * *', // every second
            run: () => {
                passes++;
                return passes === 1 ? firstPass.promise : Promise.resolve();
            },
        });
        const started = c.start();
        expect(c.status().runningSince).toBeTypeOf('number');
        await c.stop();
        firstPass.resolve();
        await started;
        await wait(1500);
        expect(passes).toBe(1);
    });

    it('should not overlap passes when start() is called twice during the first pass', async () => {
        const gate = Promise.withResolvers<void>();
        let running = 0;
        let maxRunning = 0;
        let passes = 0;
        const c = defineScheduledComponent({
            schedule: '0 0 1 1 *',
            run: async () => {
                passes++;
                running++;
                maxRunning = Math.max(maxRunning, running);
                await gate.promise;
                running--;
            },
        });

        const started = Promise.all([c.start(), c.start()]);
        gate.resolve();
        await started;

        expect(passes).toBe(1);
        expect(maxRunning).toBe(1);
        await c.stop();
    });

    it('should record a successful pass', async () => {
        const c = defineScheduledComponent({ schedule: '0 0 1 1 *', run: async () => {} });
        await c.start();
        expect(c.status().lastSuccessAt).toBeTypeOf('number');
        await c.stop();
    });

    it('should run on schedule until stopped, skipping the first pass when asked', async () => {
        let passes = 0;
        const c = defineScheduledComponent({
            schedule: '* * * * * *',
            runOnStart: false,
            run: async () => { passes++; },
        });
        await c.start();
        expect(passes).toBe(0);
        await wait(1100);
        await c.stop();
        const seen = passes;
        expect(seen).toBeGreaterThanOrEqual(1);
        await wait(1100);
        expect(passes).toBe(seen);
    });
});
