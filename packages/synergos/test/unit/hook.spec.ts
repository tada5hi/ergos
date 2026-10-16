import { describe, expect, it } from 'vitest';
import { invokeHook } from '../../src';

type Hooks = {
    onEvent?(value: number): void,
};

describe('src/hook', () => {
    it('should call the hook with its arguments and the hooks object as this', () => {
        class Recorder implements Hooks {
            values: number[] = [];

            onEvent(value: number) {
                this.values.push(value);
            }
        }

        const recorder = new Recorder();
        invokeHook<Hooks, 'onEvent'>(recorder, 'onEvent', 1);

        expect(recorder.values).toEqual([1]);
    });

    it('should do nothing without hooks or without that hook', () => {
        const hooks: Hooks = {};
        expect(() => invokeHook<Hooks, 'onEvent'>(undefined, 'onEvent', 1)).not.toThrow();
        expect(() => invokeHook(hooks, 'onEvent', 1)).not.toThrow();
    });

    it('should ignore a hook that throws', () => {
        const hooks: Hooks = { onEvent: () => { throw new Error('hook'); } };
        expect(() => invokeHook(hooks, 'onEvent', 1)).not.toThrow();
    });

    it('should ignore a hook whose promise rejects (no unhandled rejection)', async () => {
        let rejected = false;
        const hooks: Hooks = { onEvent: () => Promise.reject(new Error('hook')).finally(() => { rejected = true; }) };
        invokeHook(hooks, 'onEvent', 1);

        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(rejected).toBe(true);
    });
});
