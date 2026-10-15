import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/index.ts', 'src/amqp/index.ts'],
    format: 'esm',
    dts: true,
    sourcemap: true,
});
