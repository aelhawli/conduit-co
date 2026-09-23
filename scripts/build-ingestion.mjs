import {build} from 'esbuild-wasm';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
const key=process.env.INGESTION_SUPABASE_PUBLIC_KEY;
const siteKey=process.env.INGESTION_TURNSTILE_SITE_KEY;
if(!key?.startsWith('sb_publishable_')||!siteKey?.startsWith('0x4'))throw new Error('Provide staging public Supabase and Turnstile keys. No secret values are accepted.');
if(process.argv.includes('production'))throw new Error('Milestone2 production deployment is not authorized.');
await mkdir('dist/ingestion-web',{recursive:true});await mkdir('dist/ingestion-worker',{recursive:true});
await build({entryPoints:['src/ingestion/workspace.ts'],outfile:'dist/ingestion-web/ingestion.js',bundle:true,minify:true,format:'esm',target:'es2022',define:{__INGESTION_PUBLIC_KEY__:JSON.stringify(key),__INGESTION_TURNSTILE_KEY__:JSON.stringify(siteKey)}});
await build({entryPoints:['src/ingestion/worker.ts'],outfile:'dist/ingestion-worker/index.js',bundle:true,format:'esm',target:'es2022',platform:'node',external:['cloudflare:workers','node:*']});
await copyFile('web/ingestion.html','dist/ingestion-web/index.html');await copyFile('src/ingestion/workspace.css','dist/ingestion-web/ingestion.css');await copyFile('logo.png','dist/ingestion-web/logo.png');
await writeFile('dist/ingestion-web/_headers',`/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://kvujhszkrblaovnksafx.supabase.co https://conduit-ingestion-staging.letstalk-531.workers.dev https://531521b13c35aabe7b97954af0e2169b.r2.cloudflarestorage.com https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cache-Control: no-store
`);
console.log('Built isolated staging ingestion artifacts; M1 artifacts unchanged.');
