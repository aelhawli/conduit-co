# PostgreSQL foundation

Two additive migrations are included. They have been executed in local PGlite tests, not against a hosted Supabase project.

| Migration | Contents |
| --- | --- |
| `202609220001_foundation.sql` | 16 tables, keys, constraints, indexes, RLS and explicit privilege revocation |
| `202609220002_funnel_functions.sql` | Five service-role-only RPCs for synchronous audits, leads and events |

## Domain map

- `users`: application profile keyed to Supabase-managed `auth.users`; no signup/profile UI in M1.
- `organisations`, `memberships`: tenant and role foundation.
- `projects`: covers projects and tenders through `kind`, with tender deadline/status.
- `documents`: version, revision label and future storage pointer; M1 writes no original files here.
- `analysis_jobs`: synchronous free-audit lifecycle, hashed capability, model/prompt version, saved result.
- `findings`, `takeoff_items`, `rfis`, `revision_changes`: future domain records only.
- `leads`: name, company, email, mobile, trade, acquisition identifiers, referral hostname, consent timestamp/version, audit link and conversion state.
- `product_events`: strictly allowlisted funnel events, timestamp, page-session UUID, job UUID and client/server source. No free-form payload.
- `feature_proposals`, `campaigns`, `experiments`: future internal product/marketing records only.
- `funnel_daily_usage`: atomic global UTC-day audit attempt budget.

Future tenant records use composite organisation foreign keys to prevent cross-organisation relationships. No future feature endpoints or user-facing operations have been implemented. All foundation tables have RLS enabled, no end-user policies and no direct grants to `anon`, `authenticated`, or `service_role`. This is intentional deny-by-default, not an unfinished open data API. Future milestones must add tested policies and scoped APIs before opening access.

## Funnel RPC contracts

| Function | Behaviour |
| --- | --- |
| `start_funnel_audit` | Atomically checks global daily budget, creates running job and server upload/audit-start events |
| `complete_funnel_audit` | Persists the structured audit and completion event together |
| `fail_funnel_audit` | Records safe failure status for running jobs only |
| `capture_funnel_lead` | Validates job capability/expiry, saves contact once, records lead capture and returns saved audit |
| `record_funnel_event` | Accepts client event allowlist; validates capability for job-linked events; records unlock conversion |

Functions use `SECURITY DEFINER` with an empty search path and fully qualified tables. EXECUTE is explicitly revoked from PUBLIC/anon/authenticated and granted only to service_role. The Worker owns input validation; the database provides the transactional ownership/expiry/duplicate/budget checks. Never expose the service-role key to the browser.

The audit access token is random 256-bit material, stored only as a SHA-256 hash in PostgreSQL. Its raw value lives in page memory and POST bodies, never URLs or analytics rows. Capabilities expire after 24 hours. Reloading loses the browser capability by design; persistent projects/accounts are later milestones.

Lead retries use a row lock on the job and a unique audit-job constraint. The original contact record is retained rather than silently overwritten. Completed results are returned only after the lead transaction succeeds. `audit_unlocked` means the browser acknowledged rendering the results, so it can legitimately lag behind `lead_captured`.

Database tests simulate Supabase's managed roles and auth table; they are not a substitute for a staging PostgREST/credential smoke test. No destructive down migration is supplied. Preserve collected data and repair forward if a release is rolled back.
