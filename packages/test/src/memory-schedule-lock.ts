import type { IScheduleLock } from 'hubwire';

/**
 * In-process IScheduleLock for tests. Time comes from `Date.now()`, so vitest's fake timers
 * drive expiry: a key acquired at T with `ttlMs` is free at exactly T + ttlMs.
 * `acquired` records every acquire that won, in order; `acquireError` makes acquire() reject
 * (and record nothing).
 */
export class MemoryScheduleLock implements IScheduleLock {
    acquired: { key: string, ttlMs: number }[] = [];

    acquireError: unknown;

    // key → epoch ms it expires at
    protected expiries = new Map<string, number>();

    async acquire(key: string, ttlMs: number): Promise<boolean> {
        if (this.acquireError !== undefined) {
            throw this.acquireError;
        }

        // check and write without an await in between: two callers cannot both win
        const now = Date.now();
        for (const [held, expiresAt] of this.expiries) {
            if (expiresAt <= now) {
                this.expiries.delete(held);
            }
        }

        if (this.expiries.has(key)) {
            return false;
        }

        this.expiries.set(key, now + ttlMs);
        this.acquired.push({ key, ttlMs });
        return true;
    }
}
