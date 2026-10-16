import { describe, expect, it } from 'vitest';
import { Component, LocalDispatcher } from '../../src';
import type { TestEventMap } from './fakes/component';
import { TestComponent } from './fakes/component';

describe('src/dispatcher/local', () => {
    it('should return the forwarded events in order', async () => {
        const result = await new LocalDispatcher(new TestComponent()).dispatch('execute', { id: 'a' });

        expect(result.replies).toEqual([{
            key: 'executionFinished',
            data: { id: 'a' },
            metadata: expect.objectContaining({ correlationId: expect.any(String) }),
        }]);
        expect(result.correlationId).toBe(result.replies[0]?.metadata.correlationId);
    });

    it('should forward an unknown command', async () => {
        const result = await new LocalDispatcher(new Component()).dispatch('nope', {});

        expect(result.replies).toEqual([{
            key: 'nope',
            data: {},
            metadata: expect.objectContaining({ correlationId: expect.any(String) }),
        }]);
    });

    it('should keep a given correlationId', async () => {
        const result = await new LocalDispatcher(new TestComponent())
            .dispatch('execute', { id: 'a' }, { correlationId: 'given' });

        expect(result.correlationId).toBe('given');
        expect(result.replies[0]?.metadata.correlationId).toBe('given');
    });

    it('should keep duplicate forwarded events', async () => {
        const component = new Component<TestEventMap>();
        component.mount('execute', async (data, ctx) => {
            await ctx.handle('executionFinished', data);
            await ctx.handle('executionFinished', data);
        });

        const result = await new LocalDispatcher(component).dispatch('execute', { id: 'a' });

        expect(result.replies).toHaveLength(2);
    });

    it('should hand forwarded events to the reply component', async () => {
        const recorded: unknown[] = [];
        const inbox = new Component<TestEventMap>();
        inbox.mount('executionFinished', (data, ctx) => {
            recorded.push(data, ctx.metadata.correlationId);
        });

        const result = await new LocalDispatcher(new TestComponent(), { reply: inbox })
            .dispatch('execute', { id: 'a' });

        expect(recorded).toEqual([{ id: 'a' }, result.correlationId]);
    });

    it('should reject when a handler throws', async () => {
        const component = new Component<TestEventMap>();
        component.mount('execute', () => { throw new Error('x'); });
        await expect(new LocalDispatcher(component).dispatch('execute', { id: 'a' })).rejects.toThrow('x');

        const inbox = new Component<TestEventMap>();
        inbox.mount('executionFinished', () => { throw new Error('x'); });
        await expect(new LocalDispatcher(new TestComponent(), { reply: inbox }).dispatch('execute', { id: 'a' }))
            .rejects.toThrow('x');
    });
});
