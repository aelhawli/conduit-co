import { build } from 'esbuild-wasm';
import { mkdir } from 'node:fs/promises';
await mkdir('dist/worker', { recursive: true });
await build({ entryPoints: ['src/worker/index.ts'], outfile: 'dist/worker/index.js', bundle: true, format: 'esm', target: 'es2022', platform: 'browser' });
