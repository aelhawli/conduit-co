import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const alice='10000000-0000-4000-8000-000000000001', bob='10000000-0000-4000-8000-000000000002';
const org='20000000-0000-4000-8000-000000000001', other='20000000-0000-4000-8000-000000000002';
const project='30000000-0000-4000-8000-000000000001';
async function api(action:string,payload:Record<string,unknown>={}) {
 const r=await db.query<{value:Record<string,unknown>}>('select public.ingestion_user($1,$2) value',[action,JSON.stringify(payload)]); return r.rows[0]!.value;
}
async function asUser(uid:string) {await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');}
const reservation=(overrides:Record<string,unknown>={})=>({project_id:project,filename:'Generated test.pdf',media_type:'application/pdf',byte_size:250000000,fingerprint:'a'.repeat(64),idempotency_key:crypto.randomUUID(),...overrides});
beforeAll(async()=>{
 db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;");
 for(const name of ['202609220001_foundation.sql','202609220002_funnel_functions.sql','20260923214709_ingestion_foundation.sql']) await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
 for(const uid of [alice,bob]){await db.query('insert into auth.users values($1)',[uid]);await db.query('insert into public.users(id) values($1)',[uid]);}
 await db.query("insert into public.organisations(id,name) values($1,'Tenant A'),($2,'Tenant B')",[org,other]);
 await db.query("insert into public.memberships(organisation_id,user_id,role) values($1,$2,'owner'),($3,$4,'owner')",[org,alice,other,bob]);
 await asUser(alice);await api('create_project',{id:project,organisation_id:org,name:'Synthetic tender'});
});

async function internal<T=Record<string,unknown>>(action:string,payload:Record<string,unknown>={}):Promise<T>{
 await db.exec('reset role;set role service_role');
 const r=await db.query<{value:T}>('select public.ingestion_internal($1,$2) value',[action,JSON.stringify(payload)]);return r.rows[0]!.value;
}
async function newVersion(){
 await asUser(alice);const pid=crypto.randomUUID();await api('create_project',{id:pid,organisation_id:org,name:'Durable job test'});
 const v=await api('reserve',reservation({project_id:pid,byte_size:1000}));return {project_id:pid,version_id:v.id as string};
}
async function uploaded(){const ids=await newVersion();await internal('multipart',{...ids,multipart_id:'test-multipart'});await internal('completing',ids);await internal('uploaded',{...ids,actual_bytes:1000});return ids;}
describe('M2 durable processing and least privilege',()=>{
 it('allows a viewer to read but never authorizes an upload mutation',async()=>{
  const ids=await newVersion();await db.exec('reset role');await db.query("insert into public.memberships(organisation_id,user_id,role) values($1,$2,'viewer')",[org,bob]);
  await asUser(bob);expect((await api('version',ids)).id).toBe(ids.version_id);
  for(const action of ['write_version','cancel','delete_project'])await expect(api(action,ids)).rejects.toThrow();
  await expect(api('reserve',reservation({project_id:ids.project_id}))).rejects.toThrow();
  await db.exec('reset role');await db.query('delete from public.memberships where organisation_id=$1 and user_id=$2',[org,bob]);
 });
 it('denies internal RPC execution to browser and anonymous roles',async()=>{
  for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await expect(db.query("select public.ingestion_internal('dispatch','{}')")).rejects.toThrow(/permission denied/);}
 });
 it('fixes part digests and permits recovery from premature completion',async()=>{
  const ids=await newVersion();await internal('multipart',{...ids,multipart_id:'one'});
  expect((await internal('multipart',{...ids,multipart_id:'two'})).multipart_id).toBe('one');
  await expect(internal('part',{...ids,part:1})).rejects.toThrow('INVALID_PART');
  await internal('part',{...ids,part:1,digest:'a'.repeat(22)+'=='});
  await expect(internal('part',{...ids,part:1,digest:'b'.repeat(22)+'=='})).rejects.toThrow('FILE_CHANGED');
  await internal('completing',ids);await expect(internal('part',{...ids,part:1,digest:'a'.repeat(22)+'=='})).rejects.toThrow('UPLOAD_CLOSED');
  await internal('reopen',ids);await internal('part',{...ids,part:1,digest:'a'.repeat(22)+'=='});
 });
 it('creates exactly one job and upload metric after repeat completion',async()=>{
  const ids=await uploaded();await internal('uploaded',{...ids,actual_bytes:1000});await db.exec('reset role');
  for(const table of ['ingestion_jobs','ingestion_metrics']){const r=await db.query<{n:number}>(`select count(*)::int n from public.${table} where version_id=$1 ${table==='ingestion_metrics'?"and name='bytes_uploaded'":''}`,[ids.version_id]);expect(r.rows[0]!.n).toBe(1);}
 });
 it('fences stale workers and bounds transient processing retries to three claims',async()=>{
  const ids=await uploaded();let previous='';
  for(let attempt=1;attempt<=3;attempt++){
   const j=await internal('claim',ids);expect(j.attempt).toBe(attempt);const lease=j.lease_token;
   expect(await internal('claim',ids)).toBeNull();
   if(previous)await expect(internal('validated',{...ids,lease_token:previous,page_count:1,sha256:'a'.repeat(64)})).rejects.toThrow('STALE_LEASE');
   await internal('failed',{...ids,lease_token:lease,error_code:'PROCESSOR_UNAVAILABLE',retryable:true});previous=lease as string;
   await db.exec('reset role');await db.query("update public.ingestion_jobs set next_attempt_at=now()-interval '1 second' where version_id=$1",[ids.version_id]);
  }
  expect(await internal('claim',ids)).toBeNull();await asUser(alice);expect((await api('version',ids)).state).toBe('FAILED');
 });
 it('rejects permanent validation failures without retry and fences cancellation',async()=>{
  const ids=await uploaded();const j=await internal('claim',ids);
  await internal('failed',{...ids,lease_token:j.lease_token,error_code:'ENCRYPTED_PDF',retryable:false});expect(await internal('claim',ids)).toBeNull();
  const second=await uploaded();const active=await internal('claim',second);await asUser(alice);await api('cancel',second);
  await expect(internal('validated',{...second,lease_token:active.lease_token,page_count:1,sha256:'a'.repeat(64)})).rejects.toThrow('CANCELLED');
 });
 it('requires all pages, validates lineage, and starts retention only on completion',async()=>{
  const ids=await uploaded();const j=await internal('claim',ids);const p={...ids,lease_token:j.lease_token};
  await internal('validated',{...p,page_count:1,sha256:'b'.repeat(64)});
  await expect(internal('completed',p)).rejects.toThrow('INCOMPLETE_PAGES');
  await expect(internal('page',{...p,page_number:1,text_object_key:'other-tenant.txt',width_points:100,height_points:100,text_characters:0})).rejects.toThrow('INVALID_OBJECT_KEY');
  const v=await internal('read',ids);const prefix=`derived/${v.organisation_id}/${v.project_id}/${v.document_id}/${v.id}/${j.lease_token}/1`;
  const page={...p,page_number:1,text_object_key:prefix+'.txt',width_points:100,height_points:100,text_characters:0};
  await internal('page',page);await internal('page',page);expect((await internal('read',ids)).source_retain_until).toBeNull();
  await internal('completed',p);const completed=await internal('read',ids);expect(completed.state).toBe('COMPLETED');expect(completed.source_retain_until).toBeTruthy();
  await expect(internal('completed',p)).rejects.toThrow('STALE_LEASE');await db.exec('reset role');
  const r=await db.query<{n:number}>("select count(*)::int n from public.ingestion_metrics where version_id=$1 and name='page_count'",[ids.version_id]);expect(r.rows[0]!.n).toBe(1);
 });
 it('delays physical deletion beyond in-flight writes and detects abandoned uploads once',async()=>{
  const ids=await newVersion();await api('cancel',ids);
  expect((await internal<{id:string}[]>('cleanup_candidates')).some(v=>v.id===ids.version_id)).toBe(false);
  await db.exec('reset role');await db.query("update public.document_versions set delete_requested_at=now()-interval '31 minutes' where id=$1",[ids.version_id]);
  expect((await internal<{id:string}[]>('cleanup_candidates')).some(v=>v.id===ids.version_id)).toBe(true);
  const abandoned=await newVersion();await db.exec('reset role');await db.query("update public.upload_sessions set expires_at=now()-interval '1 second' where version_id=$1",[abandoned.version_id]);
  await internal('cleanup_candidates');await internal('cleanup_candidates');await db.exec('reset role');
  const r=await db.query<{n:number}>("select count(*)::int n from public.ingestion_metrics where version_id=$1 and name='abandoned_upload'",[abandoned.version_id]);expect(r.rows[0]!.n).toBe(1);
 });
});
afterAll(async()=>db.close());
describe('M2 tenant and reservation boundary',()=>{
 it('creates a tenant-owned project idempotently',async()=>{
  await asUser(alice);expect(await api('create_project',{id:project,organisation_id:org,name:'Synthetic tender'})).toEqual({id:project});
  await expect(api('create_project',{id:project,organisation_id:org,name:'Changed'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 });
 it('rejects forged tenant, unauthenticated and cross-tenant project access',async()=>{
  await asUser(bob);await expect(api('project',{project_id:project})).rejects.toThrow();
  await expect(api('create_project',{id:crypto.randomUUID(),organisation_id:org,name:'Stolen'})).rejects.toThrow();
  await asUser('');await expect(api('organisations')).rejects.toThrow();
 });
 it('denies direct table access even with a service key and keeps RLS enabled',async()=>{
  for(const role of ['anon','authenticated','service_role']){await db.exec('reset role;set role '+role);await expect(db.query('select * from public.document_versions')).rejects.toThrow(/permission denied/);}
  await db.exec('reset role');const r=await db.query<{n:number}>("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");expect(r.rows[0]!.n).toBe(0);
 });
 it('validates file bounds and immutable idempotency parameters',async()=>{
  await asUser(alice);for(const body of [{byte_size:250000001},{byte_size:0},{filename:'test.exe'},{media_type:'text/plain'}])await expect(api('reserve',reservation(body))).rejects.toThrow('INVALID_FILE');
  const payload=reservation();const v=await api('reserve',payload);expect((await api('reserve',payload)).id).toBe(v.id);expect(v.object_key).not.toContain('Generated');
  await expect(api('reserve',{...payload,byte_size:123})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 });
 it('counts active reservations against the exact two-billion-byte project allowance',async()=>{
  await asUser(alice);for(let n=1;n<8;n++)await api('reserve',reservation());
  expect((await api('project',{project_id:project})).reserved_bytes).toBe(2000000000);
  await expect(api('reserve',reservation({byte_size:1}))).rejects.toThrow('PROJECT_LIMIT');
 });
 it('does not let cancellation release quota before object cleanup',async()=>{
  await asUser(alice);const p=await api('project',{project_id:project});const v=(p.documents as {id:string}[])[0]!;
  await api('cancel',{project_id:project,version_id:v.id});
  await expect(api('version',{project_id:project,version_id:v.id})).rejects.toThrow();
  await expect(api('reserve',reservation({byte_size:1}))).rejects.toThrow('PROJECT_LIMIT');
 });
 it('never lets another tenant cancel or link a revision to a foreign document',async()=>{
  await asUser(bob);await expect(api('cancel',{project_id:project,version_id:crypto.randomUUID()})).rejects.toThrow();
  const bp=crypto.randomUUID();await api('create_project',{id:bp,organisation_id:other,name:'Tenant B tender'});
  await asUser(alice);const p=await api('project',{project_id:project});const doc=(p.documents as {document_id:string}[])[0]!.document_id;
  await asUser(bob);await expect(api('reserve',reservation({project_id:bp,document_id:doc}))).rejects.toThrow();
 });
});
