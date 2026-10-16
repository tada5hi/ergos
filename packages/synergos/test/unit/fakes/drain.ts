/**
 * Resolves once the microtasks queued so far (and the ones they queue) ran: the memory
 * driver delivers on microtasks, so every hop of a publish -> handler -> publish chain is done.
 */
export function drain(): Promise<void> {
    return new Promise((resolve) => { setImmediate(resolve); });
}
