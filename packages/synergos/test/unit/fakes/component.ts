import { Component } from '../../../src';
import type { ComponentMetadata } from '../../../src';

export type TestEventMap = {
    execute: [{ id: string }, ComponentMetadata],
    executionFinished: [{ id: string }, ComponentMetadata],
};

/**
 * execute → emits executionFinished (unhandled here, i.e. a reply).
 * Records start/stop, and blocks execute while `blocker` is set.
 */
export class TestComponent extends Component<TestEventMap> {
    lifecycle: string[] = [];

    blocker: Promise<void> | undefined;

    handled: string[] = [];

    constructor() {
        super();

        this.mount('execute', async (value, context) => {
            if (this.blocker) {
                await this.blocker;
            }
            this.handled.push(value.id);
            await context.handle('executionFinished', value);
        });
    }

    override async start() {
        this.lifecycle.push('start');
    }

    override async stop() {
        this.lifecycle.push('stop');
    }
}
