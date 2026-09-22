import { build } from 'esbuild-wasm';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const environment = process.argv[2] ?? 'staging';
if (!['staging','production','test'].includes(environment)) throw new Error('Unknown build environment');
const defaults = {
  staging: 'https://conduit-api-staging.letstalk.workers.dev',
  production: 'https://conduit-api-production.letstalk.workers.dev',
  test: 'http://127.0.0.1:8787'
};
const api = process.env.PUBLIC_API_BASE_URL || defaults[environment];
const siteKey = process.env.PUBLIC_TURNSTILE_SITE_KEY || (environment === 'test' ? '1x00000000000000000000AA' : '');
const url = new URL(api);
if (url.origin !== api || (environment !== 'test' && url.protocol !== 'https:')) throw new Error('API URL must be an HTTPS origin without a trailing slash');
if (environment === 'production' && (!siteKey || siteKey.startsWith('1x000') || siteKey.startsWith('2x000') || siteKey.startsWith('3x000'))) throw new Error('Production requires a real PUBLIC_TURNSTILE_SITE_KEY');
if (!siteKey) console.warn('No Turnstile site key: build is review-only; audit button is disabled until configured.');
await mkdir('dist/web', { recursive: true });
await mkdir('dist/worker', { recursive: true });
await build({ entryPoints: ['src/web/main.ts'], outfile: 'dist/web/app.js', bundle: true, minify: true, format: 'esm', target: 'es2022', define: { __API_BASE_URL__: JSON.stringify(api), __TURNSTILE_SITE_KEY__: JSON.stringify(siteKey) } });
await import('./build-worker.mjs');
execFileSync(process.execPath, [require.resolve('tailwindcss/lib/cli.js'), '-i', 'src/web/styles.css', '-o', 'dist/web/app.css', '--minify'], { stdio: 'inherit' });
await copyFile('web/index.html', 'dist/web/index.html');
await copyFile('logo.png', 'dist/web/logo.png');
const csp = `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' ${api} https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
await writeFile('dist/web/_headers', `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cache-Control: no-cache\n`);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('dist/build-info.json', JSON.stringify({ version: pkg.version, environment, apiOrigin: api, turnstileConfigured: Boolean(siteKey) }, null, 2) + '\n');
console.log(`Built ${environment}: dist/web and dist/worker (no deployment)`);
