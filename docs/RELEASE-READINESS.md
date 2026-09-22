# Milestone 1 release-readiness assessment

22 September 2026. Reviewed `35ed469` and the subsequent local release-hardening changes on `codex/milestone-1-foundation`.

**CONDITIONAL GO for the corrected code; production approval is withheld until the release gates below pass.** Original `35ed469` allowed cross-environment frontend API overrides. That blocker is fixed locally. No push, deployment, service provisioning, remote migration, secret change or Milestone 2 work was performed.

## 1. Blocking issues / release gates

- **Fixed in this review:** staging/test could compile against production through `PUBLIC_API_BASE_URL`. API destinations are now fixed by environment; production compilation rejects Pages build environments. Worker builds reject shared database URLs, Worker names or rate-limit namespaces, plaintext secret vars and cross-environment CORS. Configuration changes require review.
- **Fixed in this review:** the connecting-IP trust boundary did not exclude same-zone Worker proxies. These subrequests are now rejected. Tests verify that changing forwarding headers does not change the rate key.
- **Open operational gate:** Cloudflare read-only verification still shows automatic main and all-branch preview deployments enabled, with repository-root publishing and no build command. Disable both before any push. Never publish the repository root.
- **Open security gate:** the live legacy Worker still has a plaintext Gemini binding and unrestricted AI route. This was not changed under the no-deployment instruction. Complete its retirement/key revocation during approved cutover, before accepting the release.
- **Open verification gate:** separate hosted Supabase/Google projects, Turnstile widgets, secret bindings, backups, retention decisions and real staging acceptance have not been demonstrated. Distinct keys in one Google project do not isolate quotas or AI usage. No production approval on local mocks alone.

## 2. Non-blocking issues

- Future tenant features have no customer policies or account flow. Before exposing them, add membership-based RLS and project-consistent references; current foreign keys permit references between projects within the same organisation. Leads/events remain private global funnel data. These are later-milestone prerequisites, not a reason to expose tables now.
- PDF validation checks encoding, size and header/end markers; it is not malware scanning or a complete parser. The 7 MiB synchronous limit remains intentional.
- A disconnect can leave a running job; failed attempts consume daily capacity. There is no asynchronous recovery in M1.
- Client analytics can be dropped or fabricated within rate limits. No billing-grade interpretation.
- Browserslist emits a stale compatibility-data warning. No high/critical dependency advisory was reported. No unrelated dependency upgrades were made.

## 3. Security findings and verification

Source, generated bundles, source ZIP contents, patch and reachable Git blob history were scanned for provider keys, JWTs, private keys, database credentials and secret assignments; bundle refs were checked against scanned history. No real credentials were found; matches were explicit synthetic test values. The scan is evidence, not a mathematical guarantee against arbitrary disguised credentials. The live plaintext binding is a separate operational finding; its value was never printed or saved.

Fresh full and production-only `pnpm audit --json` checks report **zero vulnerabilities at every severity**, including high/critical. Dependencies are locked and CI actions pinned. Hosted CI has not run because nothing was pushed.

Local verification: **73 unit/security/build/database tests; 10 Chromium desktop/mobile tests; lint; strict types; frozen install; build; generated Worker type check; both environment dry-runs; whitespace check**. Windows Wrangler dry-runs used the documented local esbuild-WASM shim, not a deployment. Browser tests mock providers; PGlite is not the hosted Supabase gateway.

Gemini requires a valid server-verified Turnstile challenge with matching hostname/action, a native IP limiter and admission through the atomic UTC-day database budget. CORS alone is not authentication. IP limits are location-local and can be evaded through distributed addresses; the global cap limits model attempts, not every possible infrastructure charge. Cloudflare edge must remain the direct ingress; do not introduce an unreviewed proxy. [Cloudflare header semantics](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

Strict schemas reject lead mass assignment and extra analytics fields. Actual body bytes are bounded, regardless of Content-Length. Both frontend and server enforce size/type checks. Provider/database errors become fixed application errors. Runtime AI rendering uses text nodes only; unsafe HTML remains solely in the inert historical `.txt` baseline, outside published assets.

## 4. Database/RLS assessment

All **16 tables have RLS enabled**. There are **zero permissive customer policies** and no direct table privileges for PUBLIC, anon, authenticated or service_role. That default-deny state is appropriate for this schema-only foundation: browsers never connect to Supabase. It is not a completed tenant authorisation implementation.

Five SECURITY DEFINER RPCs have an empty search path, qualified relations and service_role-only execution. The Worker validates inputs and exposes no list/read/update/delete lead operation. Capture accepts only contact/consent/attribution fields plus one job capability, inserts once, cannot overwrite an existing contact and returns only that job's audit. Unlock updates only the capability-owned lead's conversion state. Random 256-bit capabilities are hashed at rest and expire after 24 hours. Service-role credentials remain highly privileged secrets; RPC restrictions are not a defence against their theft across the entire Supabase project.

The two migrations are transactional and reproduce the schema on a fresh database. **Raw SQL is not idempotent**; repeat CREATE fails safely. Supported repeat deployment uses Supabase migration history and skips applied versions. A staging second `db push` must be a no-op; never mask drift with IF NOT EXISTS or migration repair. No destructive down migration is supplied. [Supabase migration tracking](https://supabase.com/docs/guides/deployment/database-migrations).

## 5. Analytics/privacy assessment

Stored events contain only event/session/job identifiers, nullable organisation ID, eight allowlisted names, client/server source and time. No document contents, findings, filenames, signed URLs, contact fields, IPs or free-form properties. Job capabilities travel in authorisation POST bodies but are not stored as event data. Session/job IDs can be joined to leads by an authorised operator: these metrics are pseudonymous, not irreversibly anonymous.

Lead attribution is separate contact data; campaign identifiers must not encode personal information. Saved audit results can contain tender information even though original PDFs are transient. Approve retention/deletion and provider data-use settings; token expiry does not delete records. Review Cloudflare/Supabase platform log retention separately and do not enable request-body logging.

## 6. Required Supabase configuration

- Separate staging and production projects, credentials and backups; no production copies in staging. Confirm region, authorised operators, MFA/access controls and restore procedure. Disable public signup for M1.
- Apply only `202609220001_foundation.sql`, then `202609220002_funnel_functions.sql`, through migration history. Keep public schema available for the five RPCs, but add no table grants/customer policies or public storage buckets.
- Verify all 16 RLS flags and privileges after hosted migrations. Anon/authenticated REST reads and all five RPCs must fail; service role must execute those RPCs but cannot directly read application tables.
- Record project refs, migration history, backup coverage and retention approval. Do not run remote reset or destructive rollback.

## 7. Required Cloudflare configuration

- Disable existing production AND preview Git auto-deploys; keep them disabled through rollback. Restrict release credentials to operators, not PR/preview jobs.
- New Workers `conduit-api-staging` and `conduit-api-production`; distinct rate namespaces 71001/71002 and 72001/72002 (confirm unused). Audit limit 3/minute/IP, funnel limit 30/minute/IP/endpoint; daily audit attempts 25 and 250 respectively.
- Verify Worker version-preview URLs are disabled, including historical versions; no production bindings in preview jobs. Pinned Wrangler defaults previews off, but verify actual cloud state. [Preview URL controls](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/).
- Separate staging Pages project `conduit-co-staging`; publish only `dist/web`. Production origins exactly `https://conduitco.io` and `https://conduit-co.pages.dev`; no hash/branch previews, localhost or wildcard. Register these exact hosts in the production Turnstile widget; separate staging widget/hosts.
- Confirm CSP/security headers, no body logging, safe-log retention and alarms. Retire legacy public ingress and revoke its old key after cutover smoke tests.

## 8. Secrets/environment variables

Per Worker environment, provision **secret_text** bindings via interactive input: `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `RATE_LIMIT_SALT` (at least 32 random characters). Never copy production values into staging, local files or CI. Use separate Google projects with restricted Generative Language API keys and independent quota limits; budget alerts alone are not a hard spending cap.

Reviewed non-secret vars: `ENVIRONMENT`, `ALLOWED_ORIGINS`, `SUPABASE_URL` (replace distinct placeholders), `GEMINI_MODEL=gemini-2.5-flash`, `DAILY_AUDIT_LIMIT`. Build-only public values: `PUBLIC_TURNSTILE_SITE_KEY`, optional `PUBLIC_API_BASE_URL` exactly matching the fixed environment origin. Google model availability and settings require staging verification. Cloudflare/Supabase operator credentials stay outside application code.

## 9. Exact deployment order — future approved operation only

1. Disable Pages auto-deploys; record existing deployment/version IDs below. Review and approve the final local commit/configuration. Only then may a separately authorised push occur; CI contains no deploy or migration step.
2. Establish isolated **staging** services and select staging project explicitly: `supabase link --project-ref <STAGING_REF>`, `supabase migration list --linked`, `supabase db push --dry-run`, then approved `supabase db push`. Repeat list/dry-run/push and confirm no pending migrations. Record CLI version and use the same version for production.
3. Set staging URL/widget; run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm worker:check`, `pnpm test:e2e`, both dependency audits. Provision each of the four secrets with `pnpm worker:cli secret put <NAME> --env staging`; deploy `pnpm worker:cli deploy --env staging`. If creation is required first, deploy the new Worker without secrets; it fails closed. Never use the legacy name or `--keep-vars`.
4. Build staging with its public widget key: `pnpm build`; inspect `dist/build-info.json`; publish `pnpm worker:cli pages deploy dist/web --project-name conduit-co-staging --branch main`. Perform the tests below, including hosted permission checks and backup/rollback rehearsal. Obtain production approval only after evidence is recorded.
5. Establish isolated **production** services, approve data handling/retention, link explicitly to `<PRODUCTION_REF>` and verify it differs from staging. Repeat migration list, dry-run, apply and no-op check. Verify RLS/RPC grants. Record a recovery point; do not point new code at an unverified schema.
6. Update distinct production vars, regenerate/check types and rerun checks. Provision all four production secrets interactively using `--env production`; deploy `pnpm worker:cli deploy --env production`. Verify secret binding types, quotas and disabled preview URLs. Record deployed version ID. Old frontend remains live during these steps.
7. In a clean manual release environment, set the real production public widget key and run `pnpm build:production`. Verify `dist/build-info.json` and compiled API origin. Archive/checksum this exact artifact. Publish `pnpm worker:cli pages deploy dist/web --project-name conduit-co --branch main`. Record the new Pages production deployment ID. Do not publish this artifact to preview branches.
8. Perform production smoke tests immediately. On success disable legacy Worker ingress and revoke its old key; test it no longer invokes Gemini. Record completion and monitor errors, lead counts and daily capacity. On failure use the rollback sequence, preserving the database. Do not declare success while the old unrestricted endpoint remains usable.

## 10. Post-deployment smoke tests

- Load both intended production origins: TLS, branding/mobile layout, CSP, Turnstile and no browser secret leakage. Preview/localhost/unapproved origins must fail API CORS; production Worker preview URLs must be unavailable.
- Use an authorised non-confidential small PDF and synthetic contact: summary first, then all five fields saved, one lead/job link, consent/time/source/conversion, risks only after save. Retry capture: one unchanged lead. Simulate save failure in staging: gate remains closed and retry works.
- Check all eight events by session/job; inspect rows for payload/PII absence. No raw PDF retained. Missing client events can be best-effort loss, not a failed server transaction.
- In staging, malformed/non-PDF/over-7-MiB bodies fail; invalid/replayed Turnstile fails before AI; unsupported lead methods and extra fields fail. Wrong/expired job tokens cannot reveal audits. Hostile AI HTML displays as text.
- Repeat requests past limit from one IP while varying X-Forwarded-For/X-Real-IP: still limited. Worker proxies denied. Exhaust a deliberately small staging daily budget and confirm no extra provider call. Do not exhaust production capacity for testing.
- Hosted anon/authenticated table/RPC access denied; service role limited as above. Validate database/provider failures expose no internal text. Confirm staging changes no production rows or AI-project usage.
- Verify old endpoint disabled, new secret types correct, monitoring active and recorded rollback identifiers available. `/health` alone proves none of the provider/database checks.

## 11. Exact rollback procedure

Baseline recorded and reverified read-only: Pages deployment **`d26b3143-6454-4618-9a00-7b3df55d91ea`**; Worker **`withered-salad-c16e`**, version **`a6117d3b-42c9-43b7-811c-0978e988815e`**. Verify these remain the intended pre-release versions immediately before cutover.

1. Stop further releases; keep automatic deployments disabled. Record incident time and current Pages/Worker IDs. Leave production Supabase online and unchanged. Record lead count/latest timestamp through the authorised console; protect a current recovery point without exporting PII to public artifacts.
2. **Before legacy retirement:** in Cloudflare Pages → `conduit-co` → Deployments, select the baseline production deployment above and use **Rollback to this deployment**. The existing legacy Worker is compatible with that HTML; no backend change is needed. Verify landing page and small test audit. This emergency rollback reintroduces known legacy security limitations and does not persist new form submissions; it needs a short, explicitly accepted incident window.
3. **After legacy retirement:** prefer the last validated M1 Pages/Worker pair, if one exists: restore its recorded Worker version and compatible secret bindings, then its Pages deployment. First-release baseline restoration requires an explicitly approved emergency exception: while legacy ingress is disabled, restore baseline-compatible Worker source/version, replace its plaintext binding with a fresh restricted Gemini **secret**, confirm legacy response compatibility and tightly limited provider quota, then re-enable only its required endpoint and roll Pages back as in step 2. Never restore the revoked old key or assume a version rollback restores valid secrets. If this exception is not approved, leave the audit temporarily unavailable and repair forward; a secure, fully compatible baseline rollback cannot be promised after key retirement.
4. Do **not** reverse migrations, drop/truncate tables, reset the remote database, revoke the new database credentials needed by in-flight M1 clients, or restore an old backup over captured leads. Keep the new M1 API available for existing capability holders during the incident when safe, so already-open forms can finish; expired sessions require a new audit after recovery.
5. Recheck that all previously captured leads, jobs and events remain. Restoring the old frontend cannot delete them because the baseline does not use Supabase. Database disaster recovery is a separate reconciliation procedure, never an application rollback step.
6. Record rollback and residual risk; repair forward and restore the validated M1 pair. Retire the emergency legacy endpoint/key again. No migration rollback is needed for either path.

The baseline can be restored without losing **already captured** M1 leads. It cannot simultaneously provide the new persistent lead capture or new security controls. Staging rehearsal and operator acceptance of this first-release tradeoff are mandatory production gates.
