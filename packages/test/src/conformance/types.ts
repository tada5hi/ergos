import type { IMessageBusDriver } from 'synergos';

/**
 * The part of a test framework the suite needs; vitest's and node:test's
 * describe / it satisfy it.
 */
export type ConformanceFramework = {
    describe(name: string, fn: () => void): unknown,
    it(name: string, fn: () => Promise<void>): unknown,
};

/**
 * Called once per case; the case closes the driver it got.
 */
export type ConformanceDriverFactory = () => IMessageBusDriver | Promise<IMessageBusDriver>;
