import { describe, it } from 'vitest';
import { MemoryMessageBusDriver } from 'hubwire';
import { defineDriverConformance } from '../../src';

// the reference driver; also the vitest wiring a driver author copies
describe('src/module', () => {
    defineDriverConformance({ describe, it }, () => new MemoryMessageBusDriver());
});
