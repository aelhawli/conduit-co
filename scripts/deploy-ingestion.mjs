import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(await readFile('wrangler.ingestion.jsonc','utf8'));
if(process.argv.length!==2||config.name!=='conduit-ingestion-staging'||config.account_id!=='531521b13c35aabe7b97954af0e2169b'||config.vars.ENVIRONMENT!=='staging'||config.vars.SUPABASE_URL!=='https://kvujhszkrblaovnksafx.supabase.co'||config.vars.R2_BUCKET!=='conduit-ingestion-staging'||config.routes||config.env||config.containers.length!==1||config.containers[0].max_instances!==1)throw Error('Staging deployment guard failed');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.ingestion.jsonc'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
process.exitCode=result.status??1;
