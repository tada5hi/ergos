import { describe, expect, it } from 'vitest';
import { Component, DirectComponentCaller } from '../../src';
import type { ComponentMetadata, IComponent } from '../../src';
import { TestComponent } from './fakes/component';

describe('src/caller/direct', () => {
    it('should return the events the component emitted', async () => {
        const caller = new DirectComponentCaller(new TestComponent());
        await expect(caller.callAndWait('execute', { id: 'a' }, {}))
            .resolves.toEqual({ executionFinished: { id: 'a' } });
    });

    it('should set a correlationId when absent and keep a given one', async () => {
        const seen: (string | undefined)[] = [];
        const component = new Component<{ run: [Record<string, unknown>, ComponentMetadata] }>();
        component.mount('run', (_data, ctx) => { seen.push(ctx.metadata.correlationId); });
        const caller = new DirectComponentCaller(component);

        await caller.call('run', {}, {});
        await caller.call('run', {}, { correlationId: 'given' });

        expect(seen[0]).toBeTypeOf('string');
        expect(seen[0]).not.toBe('');
        expect(seen[1]).toBe('given');
    });

    it('should resolve an unknown command, reporting it as unhandled', async () => {
        const caller = new DirectComponentCaller(new Component());
        await expect(caller.callAndWait('nope', {}, {})).resolves.toEqual({ nope: {} });
    });

    it('should reject a component that can not be called', async () => {
        const component: IComponent = {
            start: () => Promise.resolve(),
            stop: () => Promise.resolve(),
            status: () => ({}),
        };
        await expect(new DirectComponentCaller(component).call('run', {}, {})).rejects.toThrow();
    });
});
