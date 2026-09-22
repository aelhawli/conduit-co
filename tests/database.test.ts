import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

let db: PGlite;
const sid = '11111111-1111-4111-8111-111111111111';
const job = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);
const audit = {summary:'Summary',topRisks:[{title:'Risk',description:'Review scope'}]};
async function scalar(sql: string, args: unknown[] = []) { const r = await db.query<Record<string,unknown>>(sql,args); return Object.values(r.rows[0] ?? {})[0]; }
beforeAll(async () => {
  db = new PGlite();
  // Model Supabase-managed roles/auth table without contacting any remote database.
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); grant usage on schema public to anon, authenticated, service_role;');
  await db.exec(await readFile('supabase/migrations/202609220001_foundation.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/202609220002_funnel_functions.sql','utf8'));
});
afterAll(async () => { await db.close(); });
describe('PostgreSQL migrations and RPCs', () => {
  it('reproduces the schema on a fresh database and fails safely on raw SQL replay', async () => {
    const clean = new PGlite();
    try {
      await clean.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); grant usage on schema public to anon, authenticated, service_role;');
      for (const file of ['202609220001_foundation.sql', '202609220002_funnel_functions.sql']) await clean.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
      const catalog = "select c.relname, c.relrowsecurity, c.relacl::text, a.attname, format_type(a.atttypid,a.atttypmod) as type from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum";
      expect((await clean.query(catalog)).rows).toEqual((await db.query(catalog)).rows);
      await clean.exec("insert into public.organisations(name) values ('Preserve on replay')");
      await expect(clean.exec(await readFile('supabase/migrations/202609220001_foundation.sql','utf8'))).rejects.toThrow(/already exists/);
      await clean.exec('rollback');
      expect((await clean.query('select name from public.organisations')).rows).toEqual([{name:'Preserve on replay'}]);
    } finally { await clean.close(); }
  });
  it('denies every direct table privilege to all API roles and all RPCs to browser roles', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const tables = await db.query<{ name: string; allowed: boolean }>("select c.relname as name, has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as allowed from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'", [role]);
      expect(tables.rows).toHaveLength(16); expect(tables.rows.every(t => !t.allowed)).toBe(true);
      const functions = await db.query<{ allowed: boolean; secure: boolean }>("select has_function_privilege($1,p.oid,'EXECUTE') as allowed, p.prosecdef and p.proconfig @> array['search_path=\"\"'] as secure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'", [role]);
      expect(functions.rows).toHaveLength(5);
      expect(functions.rows.every(f => f.allowed === (role === 'service_role') && f.secure)).toBe(true);
    }
    expect(await scalar("select count(*)::int from pg_policies where schemaname='public'")).toBe(0);
  });
  it('creates every requested domain and enables RLS on every table', async () => {
    const result = await db.query<{relname:string;relrowsecurity:boolean}>("select relname, relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'");
    expect(result.rows).toHaveLength(16); expect(result.rows.every(t=>t.relrowsecurity)).toBe(true);
    expect(result.rows.map(t=>t.relname)).toEqual(expect.arrayContaining(['users','organisations','memberships','leads','projects','documents','analysis_jobs','findings','takeoff_items','rfis','revision_changes','product_events','feature_proposals','campaigns','experiments']));
  });
  it('denies anonymous/authenticated RPC execution and direct reads', async () => {
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query('select * from public.leads')).rejects.toThrow(/permission denied/);
        await expect(db.query('select public.start_funnel_audit($1,$2,$3,$4,$5)',[job,token,sid,'gemini-2.5-flash',2])).rejects.toThrow(/permission denied/);
      } finally { await db.exec('reset role'); }
    }
  });
  it('allows only service-role RPC access and saves audit milestones', async () => {
    await db.exec('set role service_role');
    try {
      await expect(db.query('select * from public.leads')).rejects.toThrow(/permission denied/);
      expect(await scalar('select public.start_funnel_audit($1,$2,$3,$4,$5)',[job,token,sid,'gemini-2.5-flash',2])).toBe(true);
      expect(await scalar('select public.complete_funnel_audit($1,$2)',[job,JSON.stringify(audit)])).toBe(true);
    } finally { await db.exec('reset role'); }
    expect(await scalar("select count(*)::int from public.product_events where job_id=$1",[job])).toBe(3);
  });
  it('rejects the wrong audit token without creating a lead', async () => {
    expect(await scalar('select public.capture_funnel_lead($1,$2,$3,$4,$5,$6,$7,$8,$9)',[job,'b'.repeat(64),'Test','Company','test@example.com','0400000000','Electrical','{}','audit-contact-v1'])).toBeNull();
    expect(await scalar('select count(*)::int from public.leads')).toBe(0);
  });
  it('saves all contact and attribution fields, timestamp and conversion state atomically', async () => {
    expect(await scalar('select public.capture_funnel_lead($1,$2,$3,$4,$5,$6,$7,$8,$9)',[job,token,'Test Person','Company','TEST@example.com','0400000000','Electrical',JSON.stringify({source:'google',medium:'cpc',campaign:'launch',referralHost:'example.com'}),'audit-contact-v1'])).toEqual(audit);
    const r = await db.query<Record<string,unknown>>('select * from public.leads');
    expect(r.rows[0]).toMatchObject({name:'Test Person',company:'Company',email:'test@example.com',mobile:'0400000000',trade:'Electrical',audit_job_id:job,acquisition_source:'google',campaign_code:'launch',conversion_state:'captured'});
    expect(r.rows[0]?.created_at).toBeTruthy(); expect(r.rows[0]?.contact_consent_at).toBeTruthy();
  });
  it('does not duplicate or overwrite lead data on a retried request', async () => {
    await scalar('select public.capture_funnel_lead($1,$2,$3,$4,$5,$6,$7,$8,$9)',[job,token,'Changed','Other','other@example.com','0411111111','Plumbing','{}','audit-contact-v1']);
    expect(await scalar('select count(*)::int from public.leads')).toBe(1);
    expect(await scalar('select name from public.leads')).toBe('Test Person');
    expect(await scalar("select count(*)::int from public.product_events where name='lead_captured'")).toBe(1);
  });
  it('validates job ownership on events and records unlock exactly once', async () => {
    const event = crypto.randomUUID();
    expect(await scalar('select public.record_funnel_event($1,$2,$3,$4,$5)',[event,crypto.randomUUID(),'audit_unlocked',job,token])).toBe(false);
    for (let i=0;i<2;i++) expect(await scalar('select public.record_funnel_event($1,$2,$3,$4,$5)',[event,sid,'audit_unlocked',job,token])).toBe(true);
    expect(await scalar("select count(*)::int from public.product_events where name='audit_unlocked'")).toBe(1);
    expect(await scalar('select conversion_state from public.leads')).toBe('unlocked');
  });
  it('rejects fabricated server-side analytics', async () => {
    expect(await scalar('select public.record_funnel_event($1,$2,$3,$4,$5)',[crypto.randomUUID(),sid,'lead_captured',null,null])).toBe(false);
  });
  it('counts separate upload attempts while deduplicating a retried event', async () => {
    const event = crypto.randomUUID();
    for (const id of [event,event,crypto.randomUUID()]) await scalar('select public.record_funnel_event($1,$2,$3,$4,$5)',[id,sid,'tender_upload_started',null,null]);
    expect(await scalar("select count(*)::int from public.product_events where name='tender_upload_started'")).toBe(2);
  });
  it('enforces the daily cap across audit IDs', async () => {
    expect(await scalar('select public.start_funnel_audit($1,$2,$3,$4,$5)',[crypto.randomUUID(),token,sid,'gemini-2.5-flash',2])).toBe(true);
    expect(await scalar('select public.start_funnel_audit($1,$2,$3,$4,$5)',[crypto.randomUUID(),token,sid,'gemini-2.5-flash',2])).toBe(false);
    expect(await scalar('select attempts from public.funnel_daily_usage')).toBe(2);
  });
  it('expires audit capabilities', async () => {
    await db.query("update public.analysis_jobs set expires_at=now()-interval '1 second' where id=$1",[job]);
    expect(await scalar('select public.capture_funnel_lead($1,$2,$3,$4,$5,$6,$7,$8,$9)',[job,token,'Test','Company','test@example.com','0400000000','Electrical','{}','audit-contact-v1'])).toBeNull();
  });
  it('prevents cross-organisation document references', async () => {
    const a=crypto.randomUUID(),b=crypto.randomUUID(),p=crypto.randomUUID();
    await db.query("insert into public.organisations(id,name) values ($1,'A'),($2,'B')",[a,b]);
    await db.query("insert into public.projects(id,organisation_id,name) values ($1,$2,'Tender')",[p,a]);
    await expect(db.query("insert into public.documents(organisation_id,project_id,filename) values ($1,$2,'drawing.pdf')",[b,p])).rejects.toThrow(/foreign key/);
  });
});
