import { build } from 'esbuild-wasm';
import { mkdir, readFile } from 'node:fs/promises';
import { validateWorkerConfig } from './validate-worker-config.mjs';
validateWorkerConfig(JSON.parse(await readFile('wrangler.jsonc', 'utf8')));
await mkdir('dist/worker', { recursive: true });
await build({ entryPoints: ['src/worker/index.ts'], outfile: 'dist/worker/index.js', bundle: true, format: 'esm', target: 'es2022', platform: 'browser' });
