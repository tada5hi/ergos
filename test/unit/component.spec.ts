import { describe, expect, it } from 'vitest';
import { Component } from '../../src';
import type { ComponentHandleOptions, ComponentMetadata } from '../../src';

type Ev = [Record<string, unknown>, ComponentMetadata];

type EventMap = {
    execute: [{ id: string }, ComponentMetadata],
    executionFinished: [{ id: string }, ComponentMetadata],
};

class TestComponent extends Component<EventMap> {
    constructor() {
        super();

        this.mount('execute', async (value, context) => {
            await context.handle('executionFinished', value);
        });
    }
}

describe('src/component', () => {
    it('should resolve a child handle only once the child event is handled', async () => {
        const order: string[] = [];
        const options: ComponentHandleOptions<EventMap> = {
            handle: async (_value, context) => {
                await new Promise((resolve) => {
                    setTimeout(resolve, 10);
                });
                order.push(context.key);
            },
        };

        await new TestComponent().handle('execute', { id: 'a' }, {}, options);
        order.push('done');

        expect(order).toEqual(['executionFinished', 'done']);
    });

    it('should propagate a failing child handle to the parent handler', async () => {
        const options: ComponentHandleOptions<EventMap> = {
            handle: () => {
                throw new Error('publish failed');
            },
        };

        await expect(new TestComponent().handle('execute', { id: 'a' }, {}, options))
            .rejects.toThrow('publish failed');
    });

    it('should resolve an unknown key with no "*" and no options.handle', async () => {
        const component = new Component();
        await expect(component.handle('nope', {})).resolves.toBeUndefined();
    });

    it('should prefer a specific handler over "*"', async () => {
        const calls: string[] = [];
        const component = new Component<{ run: Ev, other: Ev }>();
        component.mount('*', (_data, ctx) => { calls.push(`*:${ctx.key}`); });
        component.mount('run', () => { calls.push('run'); });

        await component.handle('run', {});
        await component.handle('other', {});

        component.unmount('run');
        await component.handle('run', {});

        expect(calls).toEqual(['run', '*:other', '*:run']);
    });

    it('should route an unhandled child event to options.handle', async () => {
        const replies: string[] = [];
        const component = new Component<{ run: Ev, done: Ev }>();
        component.mount('run', (_data, ctx) => ctx.handle('done', {}));
        await component.handle('run', {}, {}, { handle: (_d, ctx) => { replies.push(ctx.key); } });
        expect(replies).toEqual(['done']);
    });

    it('should merge the parent metadata into a child event', async () => {
        let metadata: Record<string, unknown> | undefined;
        const component = new Component<{ run: Ev, done: Ev }>();
        component.mount('run', (_data, ctx) => ctx.handle('done', {}, { b: 2 }));
        await component.handle('run', {}, { a: 1 }, { handle: (_d, ctx) => { metadata = ctx.metadata; } });
        expect(metadata).toEqual({ a: 1, b: 2 });
    });

    it('should initialize handlers once', async () => {
        let calls = 0;
        const component = new Component<{ run: Ev }>();
        component.mount('run', { initialize: () => { calls++; }, handle: () => {} });
        await Promise.all([component.handle('run', {}), component.handle('run', {})]);
        await component.handle('run', {});
        expect(calls).toBe(1);
    });

    it('should retry initialize after a failed attempt', async () => {
        let calls = 0;
        const component = new Component<{ run: Ev }>();
        component.mount('run', {
            initialize: () => {
                calls++;
                if (calls === 1) {
                    throw new Error('x');
                }
            },
            handle: () => {},
        });
        await expect(component.handle('run', {})).rejects.toThrow('x');
        await expect(component.handle('run', {})).resolves.toBeUndefined();
        expect(calls).toBe(2);
    });

    it('should track lastSuccessAt for top-level calls', async () => {
        const component = new Component<{ run: Ev }>();
        component.mount('run', () => {});
        expect(component.status().lastSuccessAt).toBeUndefined();
        await component.handle('run', {});
        expect(component.status().lastSuccessAt).toBeTypeOf('number');
        expect(component.status().runningSince).toBeUndefined();
    });

    it('should report runningSince while a call is in flight and not stamp a failure', async () => {
        let release!: () => void;
        const component = new Component<{ run: Ev }>();
        component.mount('run', () => new Promise<void>((_resolve, reject) => {
            release = () => reject(new Error('boom'));
        }));

        const pending = component.handle('run', {});
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(component.status().runningSince).toBeTypeOf('number');

        release();
        await expect(pending).rejects.toThrow('boom');
        expect(component.status().runningSince).toBeUndefined();
        expect(component.status().lastSuccessAt).toBeUndefined();
    });

    it('should start and stop as no-ops', async () => {
        const component = new Component();
        await expect(component.start()).resolves.toBeUndefined();
        await expect(component.stop()).resolves.toBeUndefined();
    });
});
