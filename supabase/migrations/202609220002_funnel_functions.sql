begin;

create function public.start_funnel_audit(p_job_id uuid, p_token_hash text, p_session_id uuid, p_model text, p_daily_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare used integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 10000 then raise exception 'Invalid limit'; end if;
  -- Atomic UTC-day budget across all Worker locations; failed attempts count too.
  insert into public.funnel_daily_usage(usage_date, attempts)
    values ((now() at time zone 'UTC')::date, 1)
  on conflict (usage_date) do update set attempts = public.funnel_daily_usage.attempts + 1
    where public.funnel_daily_usage.attempts < p_daily_limit
  returning attempts into used;
  if used is null then return false; end if;
  insert into public.analysis_jobs(id, session_id, access_token_hash, expires_at, model)
    values (p_job_id, p_session_id, p_token_hash, now() + interval '24 hours', p_model);
  insert into public.product_events(session_id, job_id, name, source)
    values (p_session_id, p_job_id, 'upload_completed', 'server'), (p_session_id, p_job_id, 'audit_started', 'server');
  return true;
end $$;

create function public.complete_funnel_audit(p_job_id uuid, p_audit jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if coalesce(jsonb_typeof(p_audit->'summary'), 'null') <> 'string' or coalesce(jsonb_typeof(p_audit->'topRisks'), 'null') <> 'array' then raise exception 'Invalid result'; end if;
  update public.analysis_jobs set status = 'completed', result = p_audit, finished_at = now()
    where id = p_job_id and kind = 'free_audit' and status = 'running' returning session_id into sid;
  if sid is null then return false; end if;
  insert into public.product_events(session_id, job_id, name, source) values (sid, p_job_id, 'audit_completed', 'server') on conflict do nothing;
  return true;
end $$;

create function public.fail_funnel_audit(p_job_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.analysis_jobs set status = 'failed', error_code = 'AUDIT_FAILED', finished_at = now()
    where id = p_job_id and kind = 'free_audit' and status = 'running';
$$;

create function public.capture_funnel_lead(p_job_id uuid, p_token_hash text, p_name text, p_company text, p_email text, p_mobile text, p_trade text, p_attribution jsonb, p_consent_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.analysis_jobs%rowtype;
begin
  select * into job from public.analysis_jobs where id = p_job_id and kind = 'free_audit'
    and access_token_hash = p_token_hash and expires_at > now() and status = 'completed' for update;
  if not found then return null; end if;
  insert into public.leads(audit_job_id, name, company, email, mobile, trade, acquisition_source, acquisition_medium, campaign_code, referral_host, contact_consent_at, consent_version)
    values (p_job_id, p_name, p_company, lower(p_email), p_mobile, p_trade, p_attribution->>'source', p_attribution->>'medium', p_attribution->>'campaign', p_attribution->>'referralHost', now(), p_consent_version)
    on conflict (audit_job_id) do nothing;
  -- Retry-safe: never overwrite an already captured contact record.
  insert into public.product_events(session_id, job_id, name, source) values (job.session_id, p_job_id, 'lead_captured', 'server') on conflict do nothing;
  return job.result;
end $$;

create function public.record_funnel_event(p_event_id uuid, p_session_id uuid, p_name text, p_job_id uuid default null, p_token_hash text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_name in ('lead_form_displayed','audit_unlocked') then
    if not exists (select 1 from public.analysis_jobs where id = p_job_id and session_id = p_session_id and access_token_hash = p_token_hash and expires_at > now() and status = 'completed' and kind = 'free_audit') then return false; end if;
    if p_name = 'audit_unlocked' then
      update public.leads set conversion_state = 'unlocked', unlocked_at = coalesce(unlocked_at, now()) where audit_job_id = p_job_id and conversion_state in ('captured','unlocked');
      if not exists (select 1 from public.leads where audit_job_id = p_job_id) then return false; end if;
    end if;
  elsif p_name not in ('landing_page_visit','tender_upload_started') or p_job_id is not null or p_token_hash is not null then
    return false;
  end if;
  insert into public.product_events(id, session_id, job_id, name, source) values (p_event_id, p_session_id, p_job_id, p_name, 'client') on conflict do nothing;
  return true;
end $$;

-- Explicit grants: Supabase default EXECUTE privileges must not expose these RPCs.
revoke all on function public.start_funnel_audit(uuid,text,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.complete_funnel_audit(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.fail_funnel_audit(uuid) from public, anon, authenticated;
revoke all on function public.capture_funnel_lead(uuid,text,text,text,text,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.record_funnel_event(uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.start_funnel_audit(uuid,text,uuid,text,integer) to service_role;
grant execute on function public.complete_funnel_audit(uuid,jsonb) to service_role;
grant execute on function public.fail_funnel_audit(uuid) to service_role;
grant execute on function public.capture_funnel_lead(uuid,text,text,text,text,text,text,jsonb,text) to service_role;
grant execute on function public.record_funnel_event(uuid,uuid,text,uuid,text) to service_role;
commit;
