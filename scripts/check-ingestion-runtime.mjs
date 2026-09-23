import {createRequire} from 'node:module';
import {build} from 'esbuild-wasm';
const r=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=r('miniflare');
await build({stdin:{contents:`import {IngestionStorage} from './src/ingestion/storage'; import {FetchHttpHandler} from '@smithy/fetch-http-handler';
export default {async fetch(){
 const s=new IngestionStorage({R2_ACCOUNT_ID:'531521b13c35aabe7b97954af0e2169b',R2_BUCKET:'conduit-ingestion-staging',R2_ACCESS_KEY_ID:'synthetic',R2_SECRET_ACCESS_KEY:'synthetic'});
 s.client.config.requestHandler=new FetchHttpHandler({customFetch:async()=>new Response('<InitiateMultipartUploadResult><UploadId>synthetic-upload</UploadId></InitiateMultipartUploadResult>',{headers:{'Content-Type':'application/xml'}})});
 const id=await s.initiate({object_key:'source/synthetic.pdf'});return Response.json({id});
}}`,resolveDir:process.cwd()},outfile:'dist/ingestion-runtime-test.js',bundle:true,format:'esm',platform:'node',mainFields:['module','main'],external:['node:*']});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/ingestion-runtime-test.js',compatibilityDate:'2026-09-23',compatibilityFlags:['nodejs_compat']}));
try{const res=await mf.dispatchFetch('http://localhost');const body=await res.json();if(res.status!==200||body.id!=='synthetic-upload')throw Error('Worker storage transport check failed');console.log('Worker runtime: fetch transport and XML response parsing passed.');}finally{await mf.dispose();}

