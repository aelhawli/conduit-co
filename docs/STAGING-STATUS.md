# Milestone 1 staging setup — blocked before acceptance

22 September 2026. Started from release candidate `d1c6eda`. Staging setup is partial; the full hosted acceptance suite has **not** passed. Production recommendation: **NO-GO until staging acceptance is completed**.

## 1. Staging URLs

- Reserved frontend: https://conduit-co-staging.pages.dev — project exists, but no Pages deployment exists yet. Do not treat this as a working application.
- Deployed API: https://conduit-api-staging.letstalk-531.workers.dev — `/health` returns 200. Audits and persistence fail closed while database/Gemini configuration is absent.
- Retained the release candidate's resource names where changing them would add unnecessary differences; the Turnstile widget is named `conduit-staging`.

## 2. Release code

Application fix commit: `35220fad2330fe4471cd1a910085811a4a772c73`, on the existing local `codex/milestone-1-foundation` branch. It changes only the staging API hostname from `letstalk.workers.dev` to the actual account subdomain `letstalk-531.workers.dev`. Production configuration was not changed. This status document is recorded in a subsequent documentation commit.

The deployed Worker executable is unchanged from `d1c6eda`: SHA-256 `0214ba562156c763e3dcc39b79c76b6b4417fb19facfe0b17eb49d3acc48df61`. Source transfer was hash-verified before upload. Staging frontend was rebuilt with the corrected API hostname and real public staging Turnstile site key, but its upload was rejected.

## 3. Infrastructure created

| Resource | Identifier / configuration |
| --- | --- |
| Cloudflare Pages, direct upload only | `conduit-co-staging`; project ID `9ee33bb5-9787-4719-b0ef-c56200266f05`; branch `staging`; no Git integration |
| Cloudflare Worker | `conduit-api-staging`; deployed version `7dd867d0-a91c-4bbf-88a1-ece3ad7e86f3` at 100% |
| Worker ingress | workers.dev enabled; version-preview URLs explicitly disabled; no production domain route added |
| Audit limiter | `AUDIT_RATE_LIMITER`, namespace `71001`, 3 requests / 60 seconds |
| Funnel limiter | `FUNNEL_RATE_LIMITER`, namespace `71002`, 30 requests / 60 seconds |
| Turnstile widget | `conduit-staging`, managed, no clearance, restricted to `conduit-co-staging.pages.dev` |
| Worker secrets | `TURNSTILE_SECRET_KEY` and cryptographically random `RATE_LIMIT_SALT`, verified as `secret_text` |

Widget secret was transferred entirely within the connected Cloudflare API execution. Neither it nor the generated salt was printed, written to a local secret file or committed. No Supabase or Google resource was created. Staging resources contain no production credentials. Runtime CORS is restricted to the single staging Pages origin, narrower than local-development defaults.

## 4. Database migrations

**None applied remotely.** Supabase is listed as installed by plugin discovery, but no Supabase project/SQL tools are exposed in this task. The browser fallback opens a sign-in page, not an authenticated project dashboard. No project was selected or assumed, and no production database was accessed.

Pending, in order: `202609220001_foundation.sql`, `202609220002_funnel_functions.sql`. Hosted migration-history no-op verification, all-table RLS/privilege checks, five-RPC execute grants, advisor checks and unauthorised REST tests remain pending. Local PGlite checks still pass, but do not substitute for hosted evidence.

## 5. Tests and results

| Check | Result |
| --- | --- |
| Local lint / strict TypeScript / build | Passed after hostname fix |
| Local unit/security/database/build-isolation suite | 73 passed |
| Local mocked browser suite, desktop and mobile | 10 passed; not real hosted integration |
| Hosted API health / approved preflight | 200 / 204, passed |
| Hosted production-origin, unapproved-preview-origin and missing-origin rejection | 403, passed |
| Hosted lead GET/enumeration | 405, passed |
| Hosted analytics with extra contact property | 400, passed |
| Hosted missing database configuration | Safe 503, passed fail-closed check |
| Hosted non-PDF rejection | 400, passed |
| Hosted decoded PDF over 7 MiB | 413, passed |
| Hosted invalid Turnstile token | 403, passed negative check; positive challenge remains pending |
| Hosted native IP limiting | Burst eventually returned 429 despite changing X-Forwarded-For/X-Real-IP |
| Immediate fourth-request limit assertion | Did not pass: returned 400. Subsequent burst statuses were 400,400, then ten 429s. Do not describe this eventual limiter as a strict globally synchronous counter |
| Real Gemini audit, preview, lead gate, persistence, unlock | Blocked; no successful end-to-end run |
| Hosted event persistence / global database budget / RLS | Blocked by database access |
| Hosted desktop/mobile rendering / safe AI rendering / CSP | Blocked by frontend upload; local tests only |
| Hosted logs and browser secret-exposure inspection | Not complete; secret binding types and local build scan verified separately |

The negative tests used synthetic data only. Raw results are saved in `Milestone-1-staging-boundary-tests.json` in the review outputs.

## 6. Issues and fixes

1. **Fixed:** staging API hostname in the candidate did not match the connected Cloudflare account. One-line staging-only change, then complete local suites rerun.
2. **Blocked:** Pages asset upload returned HTTP 403 / Cloudflare code `8000013`. A fresh staging upload token was issued successfully, but a second minimal asset-authentication check was rejected too. No frontend deployment was created. Wrangler CLI has no authenticated session; the connected API handles other staging operations successfully. Resume with a working Pages upload connection or authenticated Wrangler session; do not mint broad tokens or repurpose production credentials.
3. **Blocked:** installed Supabase integration exposes no callable tools in this task; dashboard fallback requires sign-in. Reconnect/enable the integration and reload the task so project/migration/SQL tools are available.
4. **Blocked:** the staging Google project ID and secure staging Gemini credential location are not available. No shell Gemini/Supabase credential variables were present (names only were checked). The existing production Gemini binding was not read or copied.

## 7. AI request/cost observations

Zero Gemini requests were made, zero successful audits completed, and no Gemini token usage or model charges were incurred by these tests. No latency/quality/cost-per-audit conclusion is available. Cloudflare creation and boundary traffic may count toward the account's normal quotas; billing totals were not retrieved. Staging has a proposed 25-attempt UTC-day cap, but its database enforcement remains untested remotely.

## 8. Security verification

Staging secrets are secret bindings, not plaintext vars. Worker version-preview URLs are disabled. There is no Supabase service credential or Gemini key in the staging Worker, so no production AI/database crossover is possible through those missing bindings. Production origins are rejected. Request-validation and safe-error negative checks passed. Full success-path privacy, actual hosted logs and hosted RLS remain unverified.

Read-only post-setup verification confirmed the existing production Pages deployment is still `d26b3143-6454-4618-9a00-7b3df55d91ea`, and the legacy Worker version is still `a6117d3b-42c9-43b7-811c-0978e988815e`. `conduitco.io`, production data, legacy Worker, its credentials and its routes were not modified. No Git push occurred; no automatic Git deployment was triggered.

## 9. Production checklist

Before requesting production approval: restore staging integration access; establish isolated Supabase and Google projects; provision their staging secrets; apply/verify migrations; publish frontend; complete the real desktop/mobile upload-to-unlock journey and all hosted security tests; inspect rows/events/logs; verify independent AI quota and spend settings; rehearse data-preserving rollback; approve retention/backups; review final commit and deployment hashes. Confirm the account's actual production API hostname before a future production build—the production URL was intentionally left unchanged in this staging-only task.

Disable production/preview Git auto-deploys only under appropriate future authorisation before any push. Do not retire the legacy Worker during staging. The production cutover/key-retirement checklist in RELEASE-READINESS.md applies only after explicit production approval.

## 10. Recommendation and next required access

**NO-GO for production at this checkpoint.** This reflects incomplete hosted acceptance, not a claim that the locally tested foundation failed.

Required to resume: callable Supabase project/SQL integration (or authenticated dashboard), a working Cloudflare Pages upload authentication path, and the staging Google project ID plus secure Gemini key location. Never paste secret values into chat. No Milestone 2 work has begun.
