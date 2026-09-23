-- M2 additive staging ingestion. M1 funnel contracts and data remain unchanged.
begin;
create schema if not exists ingestion_private;
revoke all on schema ingestion_private from public, anon, authenticated;
alter table public.documents add constraint documents_project_identity unique(id,project_id,organisation_id);
alter table public.projects add column ingestion_deleted_at timestamptz;

create table public.document_versions (
 id uuid primary key default gen_random_uuid(),
 organisation_id uuid not null, project_id uuid not null, document_id uuid not null,
 version integer not null check(version>0),
 original_filename text not null check(length(original_filename) between 1 and 240),
 declared_type text not null check(declared_type='application/pdf'),
 declared_bytes bigint not null check(declared_bytes between 1 and 250000000),
 actual_bytes bigint check(actual_bytes between 1 and 250000000),
 object_key text not null unique,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
 state text not null default 'UPLOADING' check(state in('UPLOADING','UPLOADED','VALIDATING','PROCESSING','COMPLETED','FAILED','CANCELLED')),
 page_count integer check(page_count between 1 and 2000),
 duplicate_of uuid references public.document_versions(id),
 created_by uuid not null references public.users(id),
 idempotency_key uuid not null,
 created_at timestamptz not null default now(), uploaded_at timestamptz, completed_at timestamptz,
 delete_requested_at timestamptz, source_deleted_at timestamptz, deleted_at timestamptz,
 source_retain_until timestamptz, derived_retain_until timestamptz,
 unique(document_id,version), unique(project_id,idempotency_key), unique(id,project_id,organisation_id),
 foreign key(document_id,project_id,organisation_id) references public.documents(id,project_id,organisation_id)
);
create index document_versions_project_idx on public.document_versions(project_id,created_at);
create index document_versions_digest_idx on public.document_versions(project_id,sha256) where sha256 is not null and deleted_at is null;
create table public.upload_sessions (
 version_id uuid primary key references public.document_versions(id),
 multipart_id text, part_bytes integer not null default 8388608 check(part_bytes=8388608),
 part_digests jsonb not null default '{}',
 state text not null default 'UPLOADING' check(state in('UPLOADING','COMPLETING','UPLOADED','CANCELLED')),
 expires_at timestamptz not null default now()+interval '24 hours',
 upload_duration_ms bigint check(upload_duration_ms>=0),
 aborted_at timestamptz
);
create table public.ingestion_jobs (
 id uuid primary key default gen_random_uuid(), version_id uuid not null unique references public.document_versions(id),
 state text not null default 'UPLOADED' check(state in('UPLOADED','VALIDATING','PROCESSING','COMPLETED','FAILED','CANCELLED')),
 attempt integer not null default 0 check(attempt between 0 and 3),
 lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz not null default now(),
 pages_prepared integer not null default 0 check(pages_prepared>=0),
 error_code text check(error_code ~ '^[A-Z_]{1,64}$'), retryable boolean not null default false,
 created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 processing_duration_ms bigint check(processing_duration_ms>=0)
);
create index ingestion_jobs_dispatch_idx on public.ingestion_jobs(next_attempt_at) where state in('UPLOADED','VALIDATING','PROCESSING');
create table public.document_pages (
 version_id uuid not null references public.document_versions(id), page_number integer not null check(page_number between 1 and 2000),
 width_points numeric not null check(width_points>0 and width_points<=14400),
 height_points numeric not null check(height_points>0 and height_points<=14400),
 text_object_key text not null, image_object_key text,
 text_characters integer not null check(text_characters between 0 and 100000),
 lease_token uuid not null, created_at timestamptz not null default now(),
 primary key(version_id,page_number)
);
create table public.ingestion_metrics (
 id uuid primary key default gen_random_uuid(), version_id uuid references public.document_versions(id),
 name text not null check(name in('r2_operation','upload_failed','processing_retry','abandoned_upload','bytes_uploaded','upload_duration_ms','processing_duration_ms','page_count')),
 value bigint not null check(value>=0), created_at timestamptz not null default now()
);

create function ingestion_private.member(org uuid, writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.memberships m where m.organisation_id=org and m.user_id=auth.uid() and (not writing or m.role in('owner','admin','estimator')))
$$;
revoke all on function ingestion_private.member(uuid,boolean) from public,anon,authenticated,service_role;

-- No direct browser mutations. Narrow RPCs bind identity to auth.uid(), never supplied user IDs.
create function public.ingestion_user(action text, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.projects; v public.document_versions; uid uuid:=auth.uid();
 org uuid; doc uuid; version_number integer; total bigint; bytes bigint; result jsonb;
begin
 if uid is null then raise insufficient_privilege; end if;
 if action='organisations' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'role',m.role)) from public.organisations o join public.memberships m on m.organisation_id=o.id where m.user_id=uid),'[]');
 elsif action='projects' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'organisation_id',x.organisation_id,'created_at',x.created_at) order by x.created_at desc) from public.projects x where x.ingestion_deleted_at is null and ingestion_private.member(x.organisation_id)),'[]');
 elsif action='create_project' then
  org:=(payload->>'organisation_id')::uuid;
  if not ingestion_private.member(org,true) then raise insufficient_privilege; end if;
  insert into public.projects(id,organisation_id,name,created_by) values((payload->>'id')::uuid,org,payload->>'name',uid)
   on conflict(id) do nothing;
  select * into p from public.projects where id=(payload->>'id')::uuid;
  if p.organisation_id<>org or p.created_by<>uid or p.name<>payload->>'name' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('id',p.id);
 end if;
 select * into p from public.projects where id=(payload->>'project_id')::uuid for update;
 if p.id is null or p.ingestion_deleted_at is not null or not ingestion_private.member(p.organisation_id, action not in('project','version')) then raise insufficient_privilege; end if;
 if action='project' then
  return jsonb_build_object('id',p.id,'name',p.name,'organisation_id',p.organisation_id,'limit_bytes',2000000000,
   'reserved_bytes',(select coalesce(sum(declared_bytes),0) from public.document_versions where project_id=p.id and deleted_at is null),
   'documents',coalesce((select jsonb_agg(to_jsonb(d)-'fingerprint'-'idempotency_key'-'created_by'||jsonb_build_object('job', (select to_jsonb(j)-'lease_token' from public.ingestion_jobs j where j.version_id=d.id))) from public.document_versions d where d.project_id=p.id and d.deleted_at is null),'[]'));
 elsif action='reserve' then
  bytes:=(payload->>'byte_size')::bigint;
  if bytes is null or bytes<1 or bytes>250000000 or lower(right(payload->>'filename',4))<>'.pdf' or payload->>'media_type'<>'application/pdf' then raise exception 'INVALID_FILE'; end if;
  select * into v from public.document_versions where project_id=p.id and idempotency_key=(payload->>'idempotency_key')::uuid;
  if v.id is not null then
   if v.declared_bytes<>bytes or v.fingerprint<>payload->>'fingerprint' or v.original_filename<>payload->>'filename' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   if v.delete_requested_at is not null then raise exception 'CANCELLED'; end if;
   return to_jsonb(v);
  end if;
  select coalesce(sum(declared_bytes),0) into total from public.document_versions where project_id=p.id and deleted_at is null;
  if total+bytes>2000000000 then raise exception 'PROJECT_LIMIT'; end if;
  doc:=nullif(payload->>'document_id','')::uuid;
  if doc is null then
   insert into public.documents(organisation_id,project_id,filename) values(p.organisation_id,p.id,payload->>'filename') returning id into doc;
  elsif not exists(select 1 from public.documents where id=doc and project_id=p.id and organisation_id=p.organisation_id) then raise insufficient_privilege;
  end if;
  select coalesce(max(version),0)+1 into version_number from public.document_versions where document_id=doc;
  v.id:=gen_random_uuid();
  insert into public.document_versions(id,organisation_id,project_id,document_id,version,original_filename,declared_type,declared_bytes,object_key,fingerprint,created_by,idempotency_key)
  values(v.id,p.organisation_id,p.id,doc,version_number,payload->>'filename','application/pdf',bytes,
   'source/'||p.organisation_id||'/'||p.id||'/'||doc||'/'||v.id||'.pdf',payload->>'fingerprint',uid,(payload->>'idempotency_key')::uuid) returning * into v;
  insert into public.upload_sessions(version_id) values(v.id);
  return to_jsonb(v);
 elsif action='delete_project' then
  if not exists(select 1 from public.memberships where organisation_id=p.organisation_id and user_id=uid and role in('owner','admin')) then raise insufficient_privilege; end if;
  update public.projects set ingestion_deleted_at=now() where id=p.id;
  update public.document_versions set delete_requested_at=coalesce(delete_requested_at,now()),state='CANCELLED' where project_id=p.id and deleted_at is null;
  update public.ingestion_jobs set state='CANCELLED',lease_token=null,lease_until=null where version_id in(select id from public.document_versions where project_id=p.id);
  return jsonb_build_object('deleted',true);
 end if;
 select * into v from public.document_versions where id=(payload->>'version_id')::uuid and project_id=p.id and delete_requested_at is null and deleted_at is null for update;
 if v.id is null then raise insufficient_privilege; end if;
 if action in('version','write_version') then
  return to_jsonb(v)||jsonb_build_object('upload',(select to_jsonb(u) from public.upload_sessions u where u.version_id=v.id),'job',(select to_jsonb(j)-'lease_token' from public.ingestion_jobs j where j.version_id=v.id));
 elsif action='cancel' then
  update public.document_versions set delete_requested_at=now(),state='CANCELLED' where id=v.id;
  update public.upload_sessions set state='CANCELLED' where version_id=v.id;
  update public.ingestion_jobs set state='CANCELLED',lease_token=null,lease_until=null where version_id=v.id;
  return jsonb_build_object('cancelled',true);
 else raise exception 'INVALID_ACTION'; end if;
end $$;
revoke all on function public.ingestion_user(text,jsonb) from public,anon,service_role;
grant execute on function public.ingestion_user(text,jsonb) to authenticated;

do $$ declare t text; begin
 foreach t in array array['document_versions','upload_sessions','ingestion_jobs','document_pages','ingestion_metrics'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create function public.ingestion_internal(action text, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.document_versions; u public.upload_sessions; j public.ingestion_jobs;
 part text; digest text; n integer; lease uuid; duplicate_id uuid; prefix text;
begin
 if action='dispatch' then
  return coalesce((select jsonb_agg(version_id) from (select version_id from public.ingestion_jobs where
   (state='UPLOADED' or (state in('VALIDATING','PROCESSING') and lease_until<now())) and next_attempt_at<=now() order by created_at limit 20)x),'[]');
 elsif action='cleanup_candidates' then
  with expired as (
   update public.document_versions dv set delete_requested_at=now(),state='CANCELLED' from public.upload_sessions us where us.version_id=dv.id and dv.state='UPLOADING' and us.expires_at<now() and dv.delete_requested_at is null returning dv.id
  ) insert into public.ingestion_metrics(version_id,name,value) select id,'abandoned_upload',1 from expired;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select dv.id,dv.object_key,dv.organisation_id,dv.project_id,dv.document_id,dv.state,dv.delete_requested_at,dv.source_deleted_at,dv.source_retain_until,dv.derived_retain_until,us.multipart_id from public.document_versions dv join public.upload_sessions us on us.version_id=dv.id where dv.deleted_at is null and
   (dv.delete_requested_at<now()-interval '30 minutes' or dv.source_retain_until<now() or dv.derived_retain_until<now()) order by dv.created_at limit 20)x),'[]');
 end if;
 select * into v from public.document_versions where id=(payload->>'version_id')::uuid for update;
 if v.id is null then raise exception 'NOT_FOUND'; end if;
 select * into u from public.upload_sessions where version_id=v.id for update;
 if action='cleaned' then
  if v.delete_requested_at is not null or v.derived_retain_until<now() then
   update public.document_versions set deleted_at=now(),source_deleted_at=coalesce(source_deleted_at,now()),original_filename='[deleted]',fingerprint=repeat('0',64),sha256=null where id=v.id;
   delete from public.document_pages where version_id=v.id;
   update public.upload_sessions set aborted_at=now(),part_digests='{}',multipart_id=null,state='CANCELLED' where version_id=v.id;
  elsif v.source_retain_until<now() then
   update public.document_versions set source_deleted_at=now(),source_retain_until=null where id=v.id;
  else raise exception 'NOT_DUE'; end if;
  return 'true';
 end if;
 if v.delete_requested_at is not null or v.deleted_at is not null then raise exception 'CANCELLED'; end if;
 if action='read' then return to_jsonb(v)||jsonb_build_object('upload',to_jsonb(u)); end if;
 if action in('multipart','part','completing','reopen') then
  if v.state<>'UPLOADING' or u.expires_at<now() then raise exception 'UPLOAD_CLOSED'; end if;
  if action='multipart' then
   update public.upload_sessions set multipart_id=coalesce(multipart_id,payload->>'multipart_id') where version_id=v.id returning * into u;
  elsif action='part' then
   if u.state<>'UPLOADING' then raise exception 'UPLOAD_CLOSED'; end if;
   n:=(payload->>'part')::integer;part:=n::text;digest:=payload->>'digest';
   if n is null or n<1 or n>ceil(v.declared_bytes::numeric/u.part_bytes) or digest is null or digest !~ '^[A-Za-z0-9+/]{22}==$' then raise exception 'INVALID_PART'; end if;
   if u.part_digests ? part and u.part_digests->>part<>digest then raise exception 'FILE_CHANGED'; end if;
   update public.upload_sessions set part_digests=part_digests||jsonb_build_object(part,digest) where version_id=v.id returning * into u;
  elsif action='reopen' then update public.upload_sessions set state='UPLOADING' where version_id=v.id returning * into u;
  else update public.upload_sessions set state='COMPLETING' where version_id=v.id returning * into u;
  end if;
  return to_jsonb(u);
 elsif action='uploaded' then
  if v.state<>'UPLOADING' then return to_jsonb(v); end if;
  if (payload->>'actual_bytes')::bigint is distinct from v.declared_bytes or u.state<>'COMPLETING' then raise exception 'SIZE_MISMATCH'; end if;
  update public.document_versions set state='UPLOADED',actual_bytes=declared_bytes,uploaded_at=now() where id=v.id returning * into v;
  update public.upload_sessions set state='UPLOADED',upload_duration_ms=greatest(0,extract(epoch from(now()-v.created_at))*1000)::bigint where version_id=v.id;
  insert into public.ingestion_jobs(version_id) values(v.id) on conflict(version_id) do nothing;
  insert into public.ingestion_metrics(version_id,name,value) values(v.id,'bytes_uploaded',v.actual_bytes),(v.id,'upload_duration_ms',greatest(0,extract(epoch from(now()-v.created_at))*1000)::bigint);
  return to_jsonb(v);
 end if;
 select * into j from public.ingestion_jobs where version_id=v.id for update;
 if j.id is null then raise exception 'JOB_NOT_FOUND'; end if;
 if action='claim' then
  if not(j.state='UPLOADED' or (j.state in('VALIDATING','PROCESSING') and j.lease_until<now())) or j.next_attempt_at>now() then return 'null'; end if;
  if j.attempt>=3 then
   update public.ingestion_jobs set state='FAILED',error_code='RETRY_EXHAUSTED',finished_at=now(),lease_token=null where id=j.id;
   update public.document_versions set state='FAILED',source_retain_until=now()+interval '7 days',derived_retain_until=now()+interval '7 days' where id=v.id;
   return 'null';
  end if;
  update public.ingestion_jobs set state='VALIDATING',attempt=attempt+1,lease_token=gen_random_uuid(),lease_until=now()+interval '15 minutes',pages_prepared=0,started_at=coalesce(started_at,now()) where id=j.id returning * into j;
  update public.document_versions set state='VALIDATING' where id=v.id;
  delete from public.document_pages where version_id=v.id;
  return to_jsonb(j)||jsonb_build_object('source',to_jsonb(v));
 end if;
 lease:=(payload->>'lease_token')::uuid;
 if lease is null or j.lease_token is distinct from lease or j.lease_until<now() or j.state not in('VALIDATING','PROCESSING') then raise exception 'STALE_LEASE'; end if;
 if action='check_lease' then return to_jsonb(v); end if;
 if action='validated' then
  n:=(payload->>'page_count')::integer;
  if n is null or n<1 or n>2000 or payload->>'sha256' is null or payload->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DOCUMENT'; end if;
  select id into duplicate_id from public.document_versions where project_id=v.project_id and sha256=payload->>'sha256' and state='COMPLETED' and deleted_at is null and id<>v.id order by completed_at limit 1;
  update public.document_versions set state='PROCESSING',page_count=n,sha256=payload->>'sha256',duplicate_of=duplicate_id where id=v.id;
  update public.ingestion_jobs set state='PROCESSING' where id=j.id;
 elsif action='page' then
  n:=(payload->>'page_number')::integer;
  if j.state<>'PROCESSING' or n<1 or n>v.page_count then raise exception 'INVALID_PAGE'; end if;
  prefix:='derived/'||v.organisation_id||'/'||v.project_id||'/'||v.document_id||'/'||v.id||'/'||lease||'/'||n;
  if payload->>'text_object_key' is distinct from prefix||'.txt' or (payload->>'image_object_key' is not null and payload->>'image_object_key'<>prefix||'.png') then raise exception 'INVALID_OBJECT_KEY'; end if;
  insert into public.document_pages(version_id,page_number,width_points,height_points,text_object_key,image_object_key,text_characters,lease_token)
   values(v.id,n,(payload->>'width_points')::numeric,(payload->>'height_points')::numeric,payload->>'text_object_key',payload->>'image_object_key',(payload->>'text_characters')::integer,lease)
   on conflict(version_id,page_number) do update set width_points=excluded.width_points,height_points=excluded.height_points,text_object_key=excluded.text_object_key,image_object_key=excluded.image_object_key,text_characters=excluded.text_characters,lease_token=excluded.lease_token;
  update public.ingestion_jobs set pages_prepared=(select count(*) from public.document_pages where version_id=v.id) where id=j.id;
 elsif action='completed' then
  if j.state<>'PROCESSING' or j.pages_prepared<>v.page_count then raise exception 'INCOMPLETE_PAGES'; end if;
  update public.ingestion_jobs set state='COMPLETED',finished_at=now(),processing_duration_ms=greatest(0,extract(epoch from(now()-started_at))*1000)::bigint,lease_token=null,lease_until=null where id=j.id;
  update public.document_versions set state='COMPLETED',completed_at=now(),source_retain_until=now()+make_interval(days=>least(365,greatest(1,coalesce((payload->>'source_days')::integer,30)))),derived_retain_until=now()+make_interval(days=>least(365,greatest(1,coalesce((payload->>'derived_days')::integer,90)))) where id=v.id;
  insert into public.ingestion_metrics(version_id,name,value) values(v.id,'page_count',v.page_count),(v.id,'processing_duration_ms',greatest(0,extract(epoch from(now()-j.started_at))*1000)::bigint);
 elsif action='failed' then
  if coalesce((payload->>'retryable')::boolean,false) and j.attempt<3 then
   update public.ingestion_jobs set state='UPLOADED',next_attempt_at=now()+make_interval(secs=>30*j.attempt),error_code=payload->>'error_code',retryable=true,lease_token=null,lease_until=null where id=j.id;
   update public.document_versions set state='UPLOADED' where id=v.id;
   insert into public.ingestion_metrics(version_id,name,value) values(v.id,'processing_retry',1);
  else
   update public.ingestion_jobs set state='FAILED',error_code=payload->>'error_code',retryable=false,lease_token=null,lease_until=null,finished_at=now() where id=j.id;
   update public.document_versions set state='FAILED',source_retain_until=now()+interval '24 hours',derived_retain_until=now()+interval '24 hours' where id=v.id;
  end if;
 else raise exception 'INVALID_ACTION'; end if;
 return 'true';
end $$;
revoke all on function public.ingestion_internal(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingestion_internal(text,jsonb) to service_role;
comment on table public.document_versions is 'M2 immutable source versions. Quota includes reservations until durable cleanup completes.';
comment on table public.ingestion_jobs is 'M2 durable ingestion only. COMPLETED means page preparation, not AI tender analysis.';
commit;
