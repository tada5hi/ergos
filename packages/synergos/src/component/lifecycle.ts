type Release = () => Promise<void>;

/**
 * Start / stop around an acquire that returns its release: a start() joins one in flight,
 * a stop() waits for it and releases, a failed start() resets so the next one acquires again.
 */
export function createLifecycle(acquire: () => Promise<Release>) {
    let state: Promise<Release> | undefined;

    return {
        async start() {
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
        async stop() {
            const current = state;
            state = undefined;
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
        },
    };
}
