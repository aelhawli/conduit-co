-- Milestone 1 only. Additive schema; no production data migration.
begin;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (length(display_name) <= 120),
  created_at timestamptz not null default now()
);
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  created_at timestamptz not null default now()
);
create table public.memberships (
  organisation_id uuid not null references public.organisations(id),
  user_id uuid not null references public.users(id),
  role text not null check (role in ('owner','admin','estimator','viewer')),
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  name text not null check (length(name) between 1 and 240),
  kind text not null default 'tender' check (kind in ('tender','project')),
  status text not null default 'draft' check (status in ('draft','active','submitted','won','lost','archived')),
  tender_due_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (id, organisation_id)
);
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  project_id uuid not null,
  filename text not null,
  media_type text not null default 'application/pdf',
  byte_size bigint check (byte_size >= 0),
  storage_key text,
  content_hash text,
  revision_label text,
  version integer not null default 1 check (version > 0),
  supersedes_document_id uuid,
  created_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id),
  foreign key (supersedes_document_id, organisation_id) references public.documents(id, organisation_id)
);
create index projects_organisation_idx on public.projects(organisation_id, created_at);
create index documents_project_idx on public.documents(organisation_id, project_id);
create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id),
  project_id uuid,
  document_id uuid,
  kind text not null default 'free_audit',
  status text not null default 'running' check (status in ('pending','running','completed','failed','cancelled')),
  session_id uuid,
  access_token_hash text check (access_token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  model text,
  prompt_version text not null default 'free-audit-v1',
  result jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, organisation_id),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id),
  foreign key (document_id, organisation_id) references public.documents(id, organisation_id),
  check (organisation_id is not null or (project_id is null and document_id is null)),
  check (kind <> 'free_audit' or (session_id is not null and access_token_hash is not null and expires_at is not null))
);
create index analysis_jobs_status_idx on public.analysis_jobs(status, started_at);
create index analysis_jobs_project_idx on public.analysis_jobs(organisation_id, project_id);
create index analysis_jobs_expiry_idx on public.analysis_jobs(expires_at) where kind = 'free_audit';
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id),
  audit_job_id uuid not null unique references public.analysis_jobs(id),
  name text not null check (length(name) between 1 and 120),
  company text not null check (length(company) between 1 and 160),
  email text not null check (length(email) between 3 and 254),
  mobile text not null check (length(mobile) between 8 and 24),
  trade text not null check (trade in ('Electrical','Plumbing','HVAC/Mechanical','General Subbie')),
  acquisition_source text check (acquisition_source ~ '^[a-zA-Z0-9_-]{1,80}$'),
  acquisition_medium text check (acquisition_medium ~ '^[a-zA-Z0-9_-]{1,80}$'),
  campaign_code text check (campaign_code ~ '^[a-zA-Z0-9_-]{1,80}$'),
  referral_host text check (length(referral_host) <= 253),
  conversion_state text not null default 'captured' check (conversion_state in ('captured','unlocked','qualified','converted','closed')),
  contact_consent_at timestamptz not null,
  consent_version text not null,
  created_at timestamptz not null default now(),
  unlocked_at timestamptz
);
create index leads_created_idx on public.leads(created_at);
create table public.findings (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  project_id uuid not null, analysis_job_id uuid,
  category text not null, severity text check (severity in ('low','medium','high','critical')),
  title text not null, description text not null, evidence jsonb not null default '[]',
  review_state text not null default 'unreviewed', created_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id),
  foreign key (analysis_job_id, organisation_id) references public.analysis_jobs(id, organisation_id)
);
create table public.takeoff_items (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  project_id uuid not null, analysis_job_id uuid, document_id uuid,
  description text not null, quantity numeric check (quantity >= 0), unit text,
  quantity_basis text check (quantity_basis in ('counted','measured','inferred','manual')),
  evidence jsonb not null default '[]', review_state text not null default 'unreviewed', created_at timestamptz not null default now(),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id),
  foreign key (analysis_job_id, organisation_id) references public.analysis_jobs(id, organisation_id),
  foreign key (document_id, organisation_id) references public.documents(id, organisation_id)
);
create table public.rfis (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  project_id uuid not null, finding_id uuid, subject text not null, question text not null,
  status text not null default 'draft' check (status in ('draft','reviewed','sent','answered','closed')),
  created_at timestamptz not null default now(),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id),
  foreign key (finding_id, organisation_id) references public.findings(id, organisation_id)
);
create table public.revision_changes (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  project_id uuid not null, from_document_id uuid not null, to_document_id uuid not null,
  change_type text not null, description text not null, evidence jsonb not null default '[]', created_at timestamptz not null default now(),
  check (from_document_id <> to_document_id),
  foreign key (project_id, organisation_id) references public.projects(id, organisation_id),
  foreign key (from_document_id, organisation_id) references public.documents(id, organisation_id),
  foreign key (to_document_id, organisation_id) references public.documents(id, organisation_id)
);
create table public.feature_proposals (
  id uuid primary key default gen_random_uuid(), organisation_id uuid references public.organisations(id),
  proposed_by uuid references public.users(id), title text not null, description text not null,
  status text not null default 'proposed' check (status in ('proposed','reviewing','approved','rejected','shipped')),
  created_at timestamptz not null default now()
);
create table public.campaigns (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  status text not null default 'draft', starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now()
);
create table public.experiments (
  id uuid primary key default gen_random_uuid(), campaign_id uuid references public.campaigns(id),
  code text not null unique, hypothesis text not null, variants jsonb not null default '[]',
  status text not null default 'draft', created_at timestamptz not null default now()
);
create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id),
  session_id uuid not null,
  job_id uuid references public.analysis_jobs(id),
  name text not null check (name in ('landing_page_visit','tender_upload_started','upload_completed','audit_started','audit_completed','lead_form_displayed','lead_captured','audit_unlocked')),
  source text not null check (source in ('client','server')),
  occurred_at timestamptz not null default now()
  -- Deliberately no free-form properties, filenames, IPs, URLs or document/lead content.
);
create unique index product_events_job_once_idx on public.product_events(name, job_id) where job_id is not null;
create unique index product_events_visit_once_idx on public.product_events(name, session_id) where name = 'landing_page_visit';
-- Upload starts use their event UUID, so multiple attempts on one page are measured.
create index product_events_funnel_idx on public.product_events(occurred_at, name);
create table public.funnel_daily_usage (
  usage_date date primary key, attempts integer not null check (attempts > 0)
);
create index findings_project_idx on public.findings(organisation_id, project_id);
create index takeoff_items_project_idx on public.takeoff_items(organisation_id, project_id);
create index rfis_project_idx on public.rfis(organisation_id, project_id);
create index revision_changes_project_idx on public.revision_changes(organisation_id, project_id);

-- Future entities are schema only. No end-user reads or writes are opened in M1.
-- Service-role access is RPC-only too; the functions below run as their owner.
do $$
declare t text;
begin
  foreach t in array array['users','organisations','memberships','projects','documents','analysis_jobs','leads','findings','takeoff_items','rfis','revision_changes','feature_proposals','campaigns','experiments','product_events','funnel_daily_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

comment on table public.analysis_jobs is 'M1 free audits are synchronous. No background job runner is introduced.';
comment on table public.documents is 'Schema foundation only. M1 does not store original PDFs.';
comment on table public.product_events is 'Allowlisted funnel facts only; no arbitrary analytics payload.';
commit;
