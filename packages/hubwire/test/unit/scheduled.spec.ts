import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { defineScheduledComponent } from '../../src';

const wait = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('src/component/scheduled', () => {
    it('should never reject start() when the first pass fails, and report it to onError', async () => {
        const errors: unknown[] = [];
        const failure = new Error('x');
        const c = defineScheduledComponent({
            schedule: '0 0 1 1 *',
            hooks: { onError: (error) => { errors.push(error); } },
            run: async () => { throw failure; },
        });
        await expect(c.start()).resolves.toBeUndefined();
        expect(c.status().lastSuccessAt).toBeUndefined();
        expect(c.status().runningSince).toBeUndefined();
        expect(errors).toEqual([failure]);
        await c.stop();
    });

    it('should still resolve start() when onError throws', async () => {
        const c = defineScheduledComponent({
            schedule: '0 0 1 1 *',
            hooks: { onError: () => { throw new Error('hook'); } },
            run: async () => { throw new Error('x'); },
        });
        await expect(c.start()).resolves.toBeUndefined();
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
    it('should reject an invalid cron expression at definition, before any pass', () => {
        let passes = 0;
        expect(() => defineScheduledComponent({ schedule: 'nope', run: async () => { passes++; } }))
            .toThrow('nope');
        expect(passes).toBe(0);
    });

    it('should let settled() wait for the first pass in flight after stop()', async () => {
        const gate = Promise.withResolvers<void>();
        let done = false;
        const c = defineScheduledComponent({
            schedule: '0 0 1 1 *',
            run: async () => { await gate.promise; done = true; },
        });
        const started = c.start();
        await c.stop();
        const settled = c.settled().then(() => done);
        gate.resolve();
        await expect(settled).resolves.toBe(true);
        await started;
    });

    it('should let settled() wait for a later tick\'s pass in flight', async () => {
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        let done = false;
        const c = defineScheduledComponent({
            schedule: '* * * * * *',
            runOnStart: false,
            run: async () => {
                entered.resolve();
                await gate.promise;
                done = true;
            },
        });
        await c.start();
        await entered.promise;
        await c.stop();
        const settled = c.settled().then(() => done);
        gate.resolve();
        await expect(settled).resolves.toBe(true);
    });

    it('should resolve settled() at once when no pass is running', async () => {
        const c = defineScheduledComponent({
            schedule: '0 0 1 1 *', 
            runOnStart: false, 
            run: async () => {}, 
        });
        await c.settled();
        await c.start();
        await c.settled();
        await c.stop();
        await c.settled();
    });

    it('should settle a pass that stops its own component', async () => {
        const c = defineScheduledComponent({
            schedule: '0 0 1 1 *',
            run: async () => { await c.stop(); },
        });
        void c.start();
        await c.settled();
        expect(c.status().runningSince).toBeUndefined();
        expect(c.status().lastSuccessAt).toBeTypeOf('number');
    });

    describe('with fake timers', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('should settle and stay unscheduled when a pass stops its own component', async () => {
            vi.useFakeTimers({ now: new Date('2026-01-15T10:00:00.000Z') });
            const baseline = vi.getTimerCount();
            const awaited = defineScheduledComponent({
                schedule: '0 0 1 1 *',
                run: async () => {
                    await Promise.resolve();
                    await awaited.stop();
                },
            });
            const fired = defineScheduledComponent({
                schedule: '0 0 1 1 *',
                run: async () => { void fired.stop(); },
            });

            await awaited.start();
            await fired.start();

            expect(vi.getTimerCount()).toBe(baseline);
        });

        it('should not leave a timer behind after stop', async () => {
            vi.useFakeTimers({ now: new Date('2026-01-15T10:00:00.000Z') });
            const baseline = vi.getTimerCount();
            const c = defineScheduledComponent({ schedule: '0 0 1 1 *', run: async () => {} });
            await c.start();
            expect(vi.getTimerCount()).toBe(baseline + 1);
            await c.stop();
            await c.start();
            await c.stop();
            expect(vi.getTimerCount()).toBe(baseline);
        });

        it('should pass the start time as scheduledAt to the start pass', async () => {
            vi.useFakeTimers({ now: new Date('2026-01-15T10:00:00.250Z') });
            const seen: string[] = [];
            const c = defineScheduledComponent({
                schedule: '0 0 1 1 *',
                run: async ({ scheduledAt }) => { seen.push(scheduledAt.toISOString()); },
            });
            await c.start();
            await c.stop();
            expect(seen).toEqual(['2026-01-15T10:00:00.250Z']);
        });

        it('should pass each tick\'s planned fire time as scheduledAt', async () => {
            vi.useFakeTimers({ now: new Date('2026-01-15T10:00:00.500Z') });
            const seen: string[] = [];
            const c = defineScheduledComponent({
                schedule: '* * * * * *',
                runOnStart: false,
                run: async ({ scheduledAt }) => { seen.push(scheduledAt.toISOString()); },
            });
            await c.start();
            await vi.advanceTimersByTimeAsync(3000);
            await c.stop();
            expect(seen).toEqual([
                '2026-01-15T10:00:01.000Z',
                '2026-01-15T10:00:02.000Z',
                '2026-01-15T10:00:03.000Z',
            ]);
        });

        it('should pass the planned slot when the timer fires late', async () => {
            vi.useFakeTimers({ now: new Date('2026-01-15T10:00:00.500Z') });
            const seen: string[] = [];
            const c = defineScheduledComponent({
                schedule: '* * * * * *',
                runOnStart: false,
                run: async ({ scheduledAt }) => { seen.push(`${scheduledAt.toISOString()}@${new Date().toISOString()}`); },
            });
            await c.start();
            await vi.advanceTimersByTimeAsync(400);
            // the clock moves, the timer keeps its delay: it fires at 10:00:01.003
            vi.setSystemTime(Date.now() + 3);
            await vi.advanceTimersByTimeAsync(100);
            await c.stop();
            expect(seen).toEqual(['2026-01-15T10:00:01.000Z@2026-01-15T10:00:01.003Z']);
        });

        it('should wait for a slot further away than one timer can', async () => {
            vi.useFakeTimers({ now: new Date('2026-01-15T10:00:00.000Z') });
            let passes = 0;
            const c = defineScheduledComponent({
                schedule: '0 0 1 3 *', // 1 March, ~45 days: above setTimeout's 2^31-1 ms
                runOnStart: false,
                run: async () => { passes++; },
            });
            await c.start();
            await vi.advanceTimersByTimeAsync(1000);
            expect(passes).toBe(0);
            await vi.advanceTimersByTimeAsync(50 * 24 * 60 * 60 * 1000);
            await c.stop();
            expect(passes).toBe(1);
        });

        describe('timezone', () => {
            const collect = (seen: string[]) => async ({ scheduledAt }: { scheduledAt: Date }) => {
                seen.push(scheduledAt.toISOString());
            };

            it('should fire in the given timezone', async () => {
                vi.useFakeTimers({ now: new Date('2026-01-14T16:59:59.500Z') });
                const seen: string[] = [];
                const c = defineScheduledComponent({
                    schedule: '0 2 * * *',
                    timezone: 'Asia/Tokyo', // UTC+9, no DST: 02:00 JST is 17:00Z the day before
                    runOnStart: false,
                    run: collect(seen),
                });
                await c.start();
                await vi.advanceTimersByTimeAsync(1000);
                await c.stop();
                expect(seen).toEqual(['2026-01-14T17:00:00.000Z']);
            });

            it('should run a local time the spring-forward change skips one hour later', async () => {
                vi.useFakeTimers({ now: new Date('2026-03-29T00:00:00.500Z') });
                const seen: string[] = [];
                const c = defineScheduledComponent({
                    schedule: '30 2 * * *',
                    timezone: 'Europe/Berlin', // 02:30 does not exist on 2026-03-29
                    runOnStart: false,
                    run: collect(seen),
                });
                await c.start();
                await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
                await c.stop();
                expect(seen).toEqual([
                    '2026-03-29T01:30:00.000Z', // 03:30 CEST
                    '2026-03-30T00:30:00.000Z', // 02:30 CEST
                ]);
            });

            it('should run the repeated hour of a fall-back change once', async () => {
                vi.useFakeTimers({ now: new Date('2026-10-25T00:40:00.500Z') });
                const seen: string[] = [];
                const c = defineScheduledComponent({
                    schedule: '*/15 * * * *',
                    timezone: 'Europe/Berlin',
                    runOnStart: false,
                    run: collect(seen),
                });
                await c.start();
                await vi.advanceTimersByTimeAsync(100 * 60 * 1000);
                await c.stop();
                expect(seen).toEqual([
                    '2026-10-25T00:45:00.000Z', // 02:45 CEST
                    '2026-10-25T02:00:00.000Z', // 03:00 CET: the second 02:xx hour is skipped
                    '2026-10-25T02:15:00.000Z',
                ]);
            });

            it('should wait out a repeated hour it was started in, without spinning', async () => {
                // 01:10 EST, the second occurrence of 01:xx: croner answers nextRun() with a past instant here
                vi.useFakeTimers({ now: new Date('2026-11-01T06:10:00.500Z') });
                const seen: string[] = [];
                const c = defineScheduledComponent({
                    schedule: '*/15 * * * *',
                    timezone: 'America/New_York',
                    runOnStart: false,
                    run: collect(seen),
                });
                await c.start();
                await vi.advanceTimersByTimeAsync(100);
                expect(seen).toEqual([]);
                expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
                await vi.advanceTimersByTimeAsync(55 * 60 * 1000);
                await c.stop();
                expect(seen).toEqual(['2026-11-01T07:00:00.000Z']); // 02:00 EST
            });
        });
    });

    it('should reject an invalid timezone at definition, before any pass', () => {
        let passes = 0;
        expect(() => defineScheduledComponent({
            schedule: '* * * * *',
            timezone: 'Mars/Olympus',
            run: async () => { passes++; },
        })).toThrow('Mars/Olympus');
        expect(passes).toBe(0);
    });

    it('should reject a seven-field expression at definition', () => {
        expect(() => defineScheduledComponent({
            schedule: '0 0 0 * * * 2027',
            run: async () => {},
        })).toThrow('0 0 0 * * * 2027');
    });
});
