# Manual deployment and rollback — approval required

Nothing in this branch deploys automatically. Commands below are an operator runbook, **not commands already executed**. Review staging first; production requires explicit approval. The legacy Worker remains untouched so conduitco.io continues operating during review.

## Before pushing or opening a pull request

The existing Cloudflare Pages project `conduit-co` auto-deploys pushes to `main` and all preview branches. Disable both production automatic deployments and preview deployments in the project's Git build settings before pushing this branch. This prevents deployment even when the GitHub workflow itself has no deploy step. Record the previous settings. Do not re-enable automatic deployments as part of M1.

Make CI checks required on `main` and require review before merge. Neither branch protection nor cloud build settings were changed during implementation.

## Services/accounts required

| Service | Required setup |
| --- | --- |
| Cloudflare (existing account) | New `conduit-api-staging` and `conduit-api-production` Workers; native rate-limit bindings; separate staging Pages project with no Git auto-builds |
| Supabase | Separate staging and production PostgreSQL projects, region selected by owner, access restricted to the operator; production backup/retention plan |
| Google Gemini (existing integration) | Confirm `gemini-2.5-flash` availability, quotas and data-processing settings; use separate Google projects, billing/quota limits and restricted staging/production API credentials |
| Cloudflare Turnstile | Separate staging and production widgets; only exact approved frontend hostnames |
| GitHub (existing repository) | Checks-only workflow and review/branch protections |

No Stripe, PostHog, object-storage, queue, container or additional AI service is required for this milestone. Analytics are persisted first-party in PostgreSQL.

## Configuration and secrets

| Name | Location | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | Worker secret, per environment | Never in `vars`, Git, browser or query strings |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker secret, per environment | Server only. RPC execution only for this application's tables/functions |
| `TURNSTILE_SECRET_KEY` | Worker secret, per environment | Widget secret; never the public site key |
| `RATE_LIMIT_SALT` | Worker secret, per environment | At least 32 random characters; hashes IP rate-limit keys |
| `SUPABASE_URL` | `wrangler.jsonc` environment vars | Replace the staging and production placeholders with different project URLs |
| `ALLOWED_ORIGINS` | `wrangler.jsonc` | Exact origins only; no wildcards or trailing slashes |
| `ENVIRONMENT` | `wrangler.jsonc` | `staging` or `production` |
| `GEMINI_MODEL` | `wrangler.jsonc` | Currently `gemini-2.5-flash`; change only after validation |
| `DAILY_AUDIT_LIMIT` | `wrangler.jsonc` | Attempts per UTC day: 25 staging / 250 production initially |
| `PUBLIC_API_BASE_URL` | Frontend build environment | Optional; must exactly equal the environment's reviewed Worker URL; cross-environment overrides fail |
| `PUBLIC_TURNSTILE_SITE_KEY` | Frontend build environment | Public widget identifier; production build requires a real key |

Rate-limit namespaces `71001/71002` (staging) and `72001/72002` (production) are proposed identifiers. Confirm they are unused in this Cloudflare account before deployment, or select distinct identifiers. Shared identifiers share counters. The per-IP bindings enforce 3 audit requests/minute and 30 lead/event requests/minute per endpoint, with Cloudflare's documented location-local/eventually consistent behaviour. The PostgreSQL daily budget is atomic and global.

Production origins currently allow `https://conduitco.io` and `https://conduit-co.pages.dev`. Add `www` only if actually served and registered in Turnstile. Staging uses a separate Pages project and local development origins; never point a preview build at the production API or database.

## Staging sequence

1. Verify auto-deploy is disabled, then push the review branch and let checks run. Do not merge for release yet.
2. Create the staging Supabase project. Disable public signup for M1. Do not enable browser access to the foundation tables. Verify the provider's backup and region settings.
3. Use the Supabase CLI to link explicitly to the staging project. Review `supabase migration list --linked` and `supabase db push --dry-run`. Apply only the two migrations under `supabase/migrations/` using `supabase db push` after approval. Do not use `db reset` on any remote database. Alternatively apply those files in order through an approved PostgreSQL migration process that records migration history.
4. Set the staging project URL in `wrangler.jsonc`; generate types with `pnpm worker:types`. Configure a Turnstile widget for the exact staging frontend hostname.
5. Install locked dependencies and run `pnpm check`, `pnpm worker:check`, and browser tests. No live credentials are needed for these commands.
6. Create the **new staging Worker**, with its secret bindings set before exposing a working frontend. For a newly created Worker, Wrangler secret commands may create/deploy a version; they belong to this approved release step, not review. Use interactive secret input; never put values in command arguments or committed files:

   ```sh
   pnpm worker:cli secret put GEMINI_API_KEY --env staging
   pnpm worker:cli secret put SUPABASE_SERVICE_ROLE_KEY --env staging
   pnpm worker:cli secret put TURNSTILE_SECRET_KEY --env staging
   pnpm worker:cli secret put RATE_LIMIT_SALT --env staging
   pnpm worker:cli deploy --env staging
   ```

   If the CLI requires the script to exist first, create the new staging Worker from the reviewed build. It fails closed while secrets are missing; do not publish its frontend until all secrets are present. Do not use `--keep-vars` to carry legacy plaintext credentials forward.

7. Build staging with its public site key and API URL. Manually deploy **only `dist/web`** to the isolated staging Pages project:

   ```sh
   pnpm build
   pnpm worker:cli pages deploy dist/web --project-name conduit-co-staging --branch main
   ```

8. Test the real flow with a non-confidential authorised PDF: Turnstile success, summary, lead save (all five contact fields), unlock, database job link, event counts, repeated lead POST without duplicate data, allowed/denied CORS, invalid PDF and size rejection, and safe provider failures. Check the live CSP, responsiveness and audit latency. No real-provider test has been performed during implementation.

## Production cutover

1. Obtain approval of the staged result and the data/retention notice. Confirm the production project, public origin, model availability, spend cap and service settings.
2. Export/record the current Pages deployment and legacy Worker version; baseline identifiers are in `docs/baseline/deployment.json`. Preserve the existing live deployment while staging is validated.
3. Apply the reviewed additive migrations to the separate production Supabase project. Confirm RLS and RPC grants. No existing app data is migrated by these files.
4. Configure **new** `conduit-api-production` with the four secrets. Use new/restricted production Gemini credentials. Confirm `GEMINI_API_KEY` is a `secret_text` binding and absent from plaintext vars. Deploy this Worker manually using `--env production`. It does not replace the legacy endpoint.
5. Build locally with the production API URL and real Turnstile public site key using `pnpm build:production`. Set the Pages project output directory to `dist/web`; keep auto-build disabled. Production compilation deliberately refuses Cloudflare Pages build environments. For this release, manually publish only `dist/web` to `conduit-co` with `--branch main`; never upload a production artifact to a preview branch.
6. Run a production smoke test using an authorised test contact/document, verify lead persistence and events, and monitor safe error codes and the daily budget. Do not rely on a successful static `/health` response to prove database or provider readiness.
7. Retire the legacy unauthenticated endpoint and revoke its old plaintext-configured Gemini key immediately after successful cutover smoke tests, before declaring the release complete. An open-ended rollback window is not an acceptable abuse bypass. Disable its workers.dev endpoint, preview URLs and any routes. Keep the baseline source for historical review. Exact emergency rollback and its security tradeoff are documented in `RELEASE-READINESS.md`; a baseline rollback after retirement needs a fresh restricted credential supplied as a secret.

No live credentials were copied into this branch and the existing plaintext binding was not changed. Converting it or changing Worker secrets creates cloud state/version changes and is intentionally part of the approved manual cutover.

## Rollback plan

- **Frontend problem, before legacy retirement:** restore the recorded prior Pages production deployment via the dashboard rollback. It points to the untouched legacy Worker. Do not publish the new repository root.
- **New API problem:** restore the last validated version of `conduit-api-production` using Cloudflare version rollback; validate its secret bindings and database compatibility. For the first release, roll back the frontend to the baseline as above if necessary.
- **After old key retirement:** do not blindly restore an insecure/broken legacy API. Restore the last validated M1 Worker/Pages pair. If a baseline rollback is unavoidable, an operator must first restore compatible service credentials as secrets under a reviewed emergency plan.
- **Database:** these are additive foundation migrations. Roll back application traffic first, retain collected leads and job history, and repair forward. Do not drop tables or run destructive down migrations against captured leads. Restore a database backup only after a separate data-recovery decision.
- Keep production auto-deployment disabled throughout rollback. Record deployment IDs, time and operator actions.

Use the detailed ordered checklist in `RELEASE-READINESS.md` for the release assessment, smoke tests and first-release rollback. Its stricter cutover gates supersede the earlier review package.

## Operational limits before launch

- Original PDFs are transient and not stored. Audit results and leads are persisted and may contain commercially sensitive information. A 24-hour unlock token expiry is **not** deletion of stored results.
- Approve a retention policy and operational deletion process for results, contact data, events and backups. No deletion scheduler is shipped in M1.
- A disconnected browser may leave a job `running` if the Worker invocation is interrupted. M1 deliberately has no asynchronous recovery. Treat jobs still running beyond the request window as abandoned during operations review; do not bill or retry them automatically.
- Client analytics are best-effort and may be blocked or dropped. Server milestones are transactional. Do not interpret client funnel counts as billing-grade measurements.
