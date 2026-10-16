import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        // the sources, not dist: @hubwire/test's own `hubwire` import must be this package's source
        alias: [
            { find: /^hubwire$/, replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)) },
            { find: /^@hubwire\/test$/, replacement: fileURLToPath(new URL('../../test/src/index.ts', import.meta.url)) },
        ],
    },
    test: {
        include: ['test/unit/**/*.{test,spec}.{js,ts}'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx,js,jsx}'],
            thresholds: {
                branches: 80,
                functions: 80,
                lines: 80,
                statements: 80,
            },
        },
    },
});
