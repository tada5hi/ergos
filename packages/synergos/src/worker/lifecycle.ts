type Release = () => Promise<void>;

/**
 * Start / stop around an acquire that returns its release: a start() joins one in flight,
 * a stop() waits for it and releases, a start() or stop() during a release waits for it,
 * a failed start() resets so the next one acquires again.
 */
export function createLifecycle(acquire: () => Promise<Release>) {
    let state: Promise<Release> | undefined;
    // the release in flight, settled either way: start() and a later stop() queue on it in call
    // order, and a failed release stays the error of the stop() that started it
    let settled: Promise<void> | undefined;

    const stop = (): Promise<void> => {
        if (settled) {
            // a start() may be waiting for this release: stop again after it, so the last call wins
            return settled.then(stop);
        }

        const current = state;
        state = undefined;
        const released = (async () => {
            if (!current) {
                return;
            }

            let release: Release;
            try {
                release = await current;
            } catch {
                return;
            }

            await release();
        })();
        settled = released.catch(() => {}).then(() => { settled = undefined; });

        return released;
    };

    return {
        async start() {
            // acquire synchronously unless a release is in flight, so a stop() right after sees it
            while (settled) {
                await settled;
            }

            if (!state) {
                const current = acquire();
                state = current;
                current.catch(() => {
                    if (state === current) {
                        state = undefined;
                    }
                });
            }

            await state;
        },
        stop,
    };
}
