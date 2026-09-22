# Verification record — Milestone 1

Performed locally on 22 September 2026 with Node 24.19.0 / pnpm 11.19.0. No production endpoints, hosted migrations or paid AI requests were exercised.

| Check | Result |
| --- | --- |
| Frozen lockfile installation | Passed |
| ESLint | Passed |
| Strict TypeScript checking | Passed |
| Unit, security, build isolation and PostgreSQL/PGlite tests | 73 passed across 4 test files |
| Chromium browser tests | 10 passed, 5 scenarios on desktop and mobile |
| Staging web/Worker build | Passed |
| Repeated-build hash comparison | Identical HTML, JS, CSS, response headers and Worker bundle |
| Production build without a real public Turnstile key | Correctly refused; expected safety check |
| Wrangler generated environment types | Up to date |
| Staging and production Wrangler dry-runs | Passed; no deployment |
| Production and full dependency audit | No known vulnerabilities reported |
| Git whitespace validation | Passed |
| Desktop/mobile screenshots | Inspected; no horizontal overflow or clipped form fields |

The Windows sandbox prevented Wrangler's native esbuild process from traversing a parent directory. Dry-run validation was completed using a local, uncommitted compatibility shim that supplied the same-version esbuild WASM API to Wrangler. The committed application build already uses portable esbuild WASM. CI runs the standard Wrangler dry-run on Linux without that local shim. Hosted CI has not run because the branch has not been pushed.

The browser tests mock Turnstile and API responses. PostgreSQL tests execute both actual migration files inside PGlite with Supabase-compatible role names and an auth table stub; they verify role privileges and RPC behaviour but not Supabase's hosted gateway. The automated results therefore do not claim live Gemini accuracy, live Turnstile behaviour, hosted database credentials, production CSP behaviour, cloud quota availability, or backup recovery. Those require the staging acceptance checklist in DEPLOYMENT.md before release.

## Test coverage

- Exact and hostile CORS origins; allowed/disallowed preflight methods and headers.
- Request type/JSON/size bounds, PDF format markers, exact 7 MiB boundary.
- Turnstile action/hostname validation, per-IP limiter failure, global daily admission cap.
- Server-only secrets/header transport and safe errors when providers fail.
- Summary-only audit response; full risks only after successful lead persistence.
- Contact validation, consent, honeypot, attribution and duplicate-safe lead capture.
- All 16 schema tables protected with RLS and revoked direct access; service-role RPC-only permissions.
- Wrong/expired job capabilities, job-linked event ownership, cross-organisation references.
- All server milestone records; client event allowlist and idempotency; repeated upload attempts counted separately.
- AI HTML injection rendered as inert text.
- Desktop/mobile happy path, failed lead save/retry, failed replacement audit, changing files in flight and invalid file selection.
- Preview/production build rejection, fixed API origins, separate database/Worker/rate-limit configuration and rejection of plaintext secret vars.
- Worker proxy rejection and stable rate keys despite changes to user-controlled forwarding headers.
- Exhaustive direct privileges for all 16 tables and execute/search-path checks for all five RPCs; lead mass-assignment and unsupported methods.
- Fresh database schema reproduction and failed raw migration replay preserving existing data.

## Remaining release validation

1. CI in GitHub after automatic Pages builds have been disabled.
2. Apply migrations to a disposable hosted staging project and verify API grants.
3. Real Turnstile and Gemini smoke test with authorised non-confidential data.
4. Verify actual Pages security headers and end-to-end funnel records.
5. Confirm data/provider settings, retention policy, namespace availability, spend limits, and backup/rollback readiness.
