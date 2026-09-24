import {z} from 'zod';
import {Container} from '@cloudflare/containers';
export {ContainerProxy} from '@cloudflare/containers';
import {IngestionDatabase,type DatabaseEnv} from './database';
import {IngestionStorage,type StorageEnv} from './storage';
import {STAGING_API,STAGING_ORIGIN,controlSchema,reserveSchema,versionSchema,partSchema,uuid,type Version,type Job} from './contracts';
import {readJson,json} from '../worker/http';
import {checkTurnstile,hash} from '../worker/security';
import {AppError} from '../worker/errors';

interface IngestionEnv extends Pick<IngestionBindings,'ENVIRONMENT'|'CONTROL_LIMITER'|'JOB_QUEUE'|'PDF_PROCESSOR'|'SOURCE_RETENTION_DAYS'|'DERIVED_RETENTION_DAYS'>,DatabaseEnv,StorageEnv{
 TURNSTILE_SECRET_KEY:string;PROCESSOR_SIGNING_KEY:string;RATE_LIMIT_SALT:string;
}
export class PdfProcessor extends Container{
 defaultPort=8080;sleepAfter='30s';enableInternet=false;interceptHttps=true;
 allowedHosts=['531521b13c35aabe7b97954af0e2169b.r2.cloudflarestorage.com','conduit-ingestion-staging.letstalk-531.workers.dev'];
}
export function retentionDays(source:unknown,derived:unknown){
 const days=z.coerce.number().int().min(1).max(365);const source_days=days.parse(source),derived_days=days.parse(derived);
 if(derived_days<source_days)throw new Error('CONFIGURATION_ERROR');return {source_days,derived_days};
}
async function callbackToken(env:IngestionEnv,versionId:string,lease:string){
 if(env.PROCESSOR_SIGNING_KEY.length<32)throw new Error('CONFIGURATION_ERROR');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.PROCESSOR_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(versionId+':'+lease)))).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function same(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
const callbackSchema=z.object({version_id:uuid,lease_token:uuid,action:z.enum(['validated','page','completed','failed']),data:z.record(z.string(),z.unknown()).default({})}).strict();
const pageSchema=z.object({page_number:z.number().int().min(1).max(2000),width_points:z.number().positive().max(14400),height_points:z.number().positive().max(14400),text:z.string().max(100000),image_base64:z.string().max(3_000_000).optional()}).strict();
async function ensureMultipart(v:Version,db:IngestionDatabase,store:IngestionStorage){
 if(v.upload?.multipart_id||v.state!=='UPLOADING')return v;
 let created:string;
 try{created=await store.initiate(v);}catch(e){await recordUploadFailure(db,v.id);throw e;}
 try{
  const saved=await db.rpc<NonNullable<Version['upload']>>('multipart',{version_id:v.id,multipart_id:created});
  if(saved.multipart_id!==created)await store.abort({...v,upload:{...saved,multipart_id:created}});
  return {...v,upload:saved};
 }catch(e){try{await store.abort({...v,upload:{multipart_id:created,state:'UPLOADING',part_digests:{},expires_at:''}});}catch{/* R2 lifecycle aborts abandoned multipart uploads */}throw e;}
}
async function recordUploadFailure(db:IngestionDatabase,versionId:string){
 try{await db.rpc('upload_failed',{version_id:versionId});}catch{/* telemetry must not prevent upload recovery */}
}
export async function handleIngestion(request:Request,env:IngestionEnv):Promise<Response>{
 let origin:string|undefined,stage='configuration';
 try{
  if(env.ENVIRONMENT!=='staging')throw new Error('ENVIRONMENT_MISMATCH');
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return json({status:'ok',environment:'staging',service:'ingestion'},200);
  const db=new IngestionDatabase(env),store=new IngestionStorage(env);
  if(path==='/processor/callback'&&request.method==='POST'){
   const body=callbackSchema.parse(await readJson(request,3_200_000));
   const expected=await callbackToken(env,body.version_id,body.lease_token);
   if(!same(request.headers.get('Authorization')??'',`Bearer ${expected}`))throw new Error('FORBIDDEN');
   const payload={version_id:body.version_id,lease_token:body.lease_token};
   const v=await db.rpc<Version>('check_lease',payload);
   if(body.action==='page'){
    const page=pageSchema.parse(body.data);const prefix=`derived/${v.organisation_id}/${v.project_id}/${v.document_id}/${v.id}/${body.lease_token}/${page.page_number}`;
    await store.put(prefix+'.txt',page.text,'text/plain; charset=utf-8');
    let imageKey:string|null=null;
    if(page.image_base64){const bytes=Uint8Array.from(atob(page.image_base64),c=>c.charCodeAt(0));if(bytes.length>2_000_000||Array.from(bytes.slice(0,8)).join(',')!=='137,80,78,71,13,10,26,10')throw new Error('INVALID_IMAGE');imageKey=prefix+'.png';await store.put(imageKey,bytes,'image/png');}
    await db.rpc('page',{...payload,page_number:page.page_number,width_points:page.width_points,height_points:page.height_points,text_characters:page.text.length,text_object_key:prefix+'.txt',image_object_key:imageKey});
   }else{
    const data=body.action==='validated'?z.object({page_count:z.number().int().min(1).max(2000),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(body.data)
     :body.action==='failed'?z.object({error_code:z.enum(['INVALID_PDF','ENCRYPTED_PDF','CORRUPT_PDF','PAGE_LIMIT','PAGE_DIMENSIONS','OUTPUT_LIMIT','SIZE_MISMATCH','PROCESSOR_TIMEOUT','PROCESSOR_UNAVAILABLE']),retryable:z.boolean()}).strict().parse(body.data):retentionDays(env.SOURCE_RETENTION_DAYS,env.DERIVED_RETENTION_DAYS);
    await db.rpc(body.action,{...payload,...data});
   }
   return json({ok:true},200);
  }
  if(request.headers.get('Origin')!==STAGING_ORIGIN||request.headers.has('CF-Worker'))throw new Error('FORBIDDEN');origin=STAGING_ORIGIN;
  if(path!=='/control')return json({error:'NOT_FOUND'},404,origin);
  if(request.method==='OPTIONS'){
   const headers=(request.headers.get('Access-Control-Request-Headers')??'').toLowerCase().split(',').map(s=>s.trim());
   if(request.headers.get('Access-Control-Request-Method')!=='POST'||headers.some(h=>!['authorization','content-type'].includes(h)))throw new Error('FORBIDDEN');
   return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type',Vary:'Origin'}});
  }
  if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405,origin);
  const ip=request.headers.get('CF-Connecting-IP');if(!ip||env.RATE_LIMIT_SALT.length<32)throw new Error('CONFIGURATION_ERROR');
  stage='rate_limit';
  if(!(await env.CONTROL_LIMITER.limit({key:await hash(env.RATE_LIMIT_SALT+':'+ip)})).success)return json({error:'RATE_LIMITED',message:'Please wait a minute and try again.'},429,origin);
  const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];if(!token)throw new Error('UNAUTHENTICATED');stage='authentication';await db.authenticate(token);stage='operation';
  const {action,data}=controlSchema.parse(await readJson(request,8192));
  if(['organisations','projects'].includes(action))return json(await db.rpc(action,{},token),200,origin);
  if(action==='create_project'){const p=z.object({id:uuid,organisation_id:uuid,name:z.string().trim().min(1).max(240)}).strict().parse(data);return json(await db.rpc(action,p,token),200,origin);}
  if(['project','delete_project'].includes(action)){const p=z.object({project_id:uuid}).strict().parse(data);return json(await db.rpc(action,p,token),200,origin);}
  if(action==='reserve'){
   const p=reserveSchema.parse(data);await checkTurnstile(p.turnstileToken,new URL(origin).hostname,env.TURNSTILE_SECRET_KEY,fetch);
   const {turnstileToken:discarded,...reservation}=p;void discarded;
   const v=await db.rpc<Version>('reserve',reservation,token);
   const ready=await ensureMultipart(await db.rpc<Version>('write_version',{project_id:v.project_id,version_id:v.id},token),db,store);
   return json(ready,200,origin);
  }
  const p=action==='part'?partSchema.parse(data):versionSchema.parse(data);
  let v=await db.rpc<Version>(['resume','part','complete','cancel'].includes(action)?'write_version':'version',{project_id:p.project_id,version_id:p.version_id},token);
  if(action==='resume'){v=await ensureMultipart(v,db,store);return json(v,200,origin);}
  if(action==='version')return json({...v,parts:v.state==='UPLOADING'&&v.upload?.state==='UPLOADING'?await store.parts(v):[]},200,origin);
  if(action==='part'){
   const part=partSchema.parse(p);await db.rpc('part',{version_id:v.id,part:part.part,digest:part.digest});
   return json(await store.signPart(v,part.part,part.digest),200,origin);
  }
  if(action==='complete'){
   if(v.state==='UPLOADING'){
    await db.rpc('completing',{version_id:v.id});
    try{const bytes=await store.complete(v);await db.rpc('uploaded',{version_id:v.id,actual_bytes:bytes});}
    catch(e){await recordUploadFailure(db,v.id);if(e instanceof Error&&e.message==='INCOMPLETE_UPLOAD')await db.rpc('reopen',{version_id:v.id});throw e;}
   }
   // Durable DB job is the outbox; cron recovers a failed queue send.
   try{await env.JOB_QUEUE.send({versionId:v.id});}catch{console.warn(JSON.stringify({event:'ingestion_dispatch_deferred',versionId:v.id}));}
   return json({accepted:true},202,origin);
  }
  if(action==='cancel'){await db.rpc('cancel',p,token);try{await store.abort(v);}catch{/* scheduled cleanup retries */}return json({cancelled:true},200,origin);}
  if(action==='download'){if(v.state!=='COMPLETED'||v.source_deleted_at)throw new Error('SOURCE_NOT_AVAILABLE');return json({url:await store.download(v),expiresIn:60},200,origin);}
  throw new Error('INVALID_ACTION');
 }catch(e){
  const raw=e instanceof Error?e.message:'';const known=['UNAUTHENTICATED','FORBIDDEN','PROJECT_LIMIT','INVALID_FILE','INVALID_PART','FILE_CHANGED','UPLOAD_CLOSED','CANCELLED','IDEMPOTENCY_CONFLICT','INCOMPLETE_UPLOAD','SOURCE_NOT_AVAILABLE','SIZE_MISMATCH','STALE_LEASE'];
  if(e instanceof AppError&&e.code==='VERIFICATION_FAILED')return json({error:e.code,message:'Please complete the security check again.'},403,origin);
  if(e instanceof AppError&&e.status<500)return json({error:e.code,message:e.status===413?'The upload control request is too large. Select the PDF again.':'The request could not be read. Please try again.'},e.status,origin);
  const code=e instanceof z.ZodError?'INVALID_REQUEST':known.includes(raw)?raw:'SERVICE_UNAVAILABLE';
  if(code==='SERVICE_UNAVAILABLE')console.warn(JSON.stringify({event:'ingestion_request_failure',stage,errorType:e instanceof Error?e.name:'unknown',code:/^[A-Z_]{1,64}$/.test(raw)?raw:'UNEXPECTED'}));
  const status=code==='UNAUTHENTICATED'?401:code==='FORBIDDEN'?403:code==='SERVICE_UNAVAILABLE'?503:409;
  return json({error:code,message:code==='SERVICE_UNAVAILABLE'?'The service is temporarily unavailable. Your saved upload can be resumed.':code.replaceAll('_',' ').toLowerCase()},status,origin);
 }
}
export async function processVersion(env:IngestionEnv,versionId:string){
 const db=new IngestionDatabase(env),store=new IngestionStorage(env);
 const job=await db.rpc<Job|null>('claim',{version_id:versionId});if(!job)return;
 try{
  const response=await env.PDF_PROCESSOR.getByName('bounded-staging-processor').fetch(new Request('http://processor/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version_id:versionId,lease_token:job.lease_token,expected_bytes:job.source.declared_bytes,source_url:await store.download(job.source,900),callback_url:STAGING_API+'/processor/callback',callback_token:await callbackToken(env,versionId,job.lease_token)}),signal:AbortSignal.timeout(660000)}));
  // Only bounded numeric operational data crosses into logs; no PDF text, URLs or credentials.
  try{
   const raw:unknown=await response.json();const metrics:Record<string,number>={};
   if(raw&&typeof raw==='object')for(const key of ['checksum_ms','download_ms','validation_ms','page_count','preparation_ms','peak_rss_kib','cpu_ms']){
    const value=(raw as Record<string,unknown>)[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<1e12)metrics[key]=value;
   }
   console.info(JSON.stringify({event:'ingestion_processing_metrics',versionId,status:response.status,...metrics}));
  }catch{/* Missing telemetry must never retry a completed job. */}
  if(!response.ok)throw new Error('PROCESSOR_UNAVAILABLE');
 }catch{
  try{await db.rpc('failed',{version_id:versionId,lease_token:job.lease_token,error_code:'PROCESSOR_UNAVAILABLE',retryable:true});}catch{/* completed/cancelled or fenced; reconciliation handles stale leases */}
 }
}
export default{
 fetch:handleIngestion,
 async queue(batch:{messages:{body:{versionId:string};ack():void;retry():void}[]},env:IngestionEnv){for(const m of batch.messages){try{await processVersion(env,uuid.parse(m.body.versionId));m.ack();}catch{m.retry();}}},
 async scheduled(_event:unknown,env:IngestionEnv){
  if(env.ENVIRONMENT!=='staging')throw new Error('ENVIRONMENT_MISMATCH');
  const db=new IngestionDatabase(env),store=new IngestionStorage(env);
  for(const id of await db.rpc<string[]>('dispatch',{}))await env.JOB_QUEUE.send({versionId:id});
  const candidates=await db.rpc<(Version&{multipart_id:string|null;source_retain_until:string|null;derived_retain_until:string|null})[]>('cleanup_candidates',{});
  for(const v of candidates){
   try{
    const all=Boolean(v.delete_requested_at)||(v.derived_retain_until!==null&&Date.parse(v.derived_retain_until)<Date.now());
    if(all){await store.abort({...v,upload:{multipart_id:v.multipart_id,state:'CANCELLED',part_digests:{},expires_at:''}});await store.removeDerived(v);}
    await store.removeSource(v);await db.rpc('cleaned',{version_id:v.id});
   }catch{console.warn(JSON.stringify({event:'ingestion_cleanup_retry',versionId:v.id}));}
  }
 }
};
