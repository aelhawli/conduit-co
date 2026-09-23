-- Follow-up: scrub last-version filenames; count server-observed transfer failures
-- once per version and expired-lease retries without recording document content.
begin;
create unique index ingestion_upload_failure_once on public.ingestion_metrics(version_id,name) where name='upload_failed';
create or replace function public.ingestion_internal(action text, payload jsonb default '{}') returns jsonb
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
   update public.documents set filename='[deleted]' where id=v.document_id and not exists(select 1 from public.document_versions where document_id=v.document_id and deleted_at is null);
   delete from public.document_pages where version_id=v.id;
   update public.upload_sessions set aborted_at=now(),part_digests='{}',multipart_id=null,state='CANCELLED' where version_id=v.id;
  elsif v.source_retain_until<now() then
   update public.document_versions set source_deleted_at=now(),source_retain_until=null where id=v.id;
  else raise exception 'NOT_DUE'; end if;
  return 'true';
 end if;
 if v.delete_requested_at is not null or v.deleted_at is not null then raise exception 'CANCELLED'; end if;
 if action='upload_failed' then
  if v.state<>'UPLOADING' then return 'false'; end if;
  insert into public.ingestion_metrics(version_id,name,value) values(v.id,'upload_failed',1) on conflict (version_id,name) where name='upload_failed' do nothing;
  return 'true';
 end if;
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
  if j.state in('VALIDATING','PROCESSING') then
   insert into public.ingestion_metrics(version_id,name,value) values(v.id,'processing_retry',1);
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
commit;
