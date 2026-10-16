import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: { index: 'src/index.ts', conformance: 'src/conformance/index.ts' },
    format: 'esm',
    dts: true,
    sourcemap: true,
});
