# Conduit Co. — Milestone 1 foundation

Conduit's existing free PDF audit and lead-generation funnel, prepared for a future AI operating system for Australian trade contractors. This branch implements Milestone 1 only. No accounts UI, dashboard, billing, object storage, asynchronous processing, takeoffs, RFIs or document intelligence is introduced.

**Review only. Do not push this branch until Cloudflare Pages automatic production AND preview deployments have been disabled.** The existing Pages project currently deploys all preview branches. The CI workflow in this repository only runs checks, but that does not disable Cloudflare's independent Git integration.

## Structure

| Path | Purpose |
| --- | --- |
| `web/index.html` | Marketing page and accessible audit/lead forms |
| `src/web/` | TypeScript UI, safe result rendering and allowlisted analytics |
| `src/worker/` | Synchronous Gemini audit, request security, database adapter |
| `src/shared/contracts.ts` | Shared input/output schemas and upload limits |
| `supabase/migrations/` | Additive PostgreSQL schema and restricted funnel RPCs |
| `wrangler.jsonc` | Separate staging/production Worker configuration |
| `scripts/` | Reproducible builds and local static preview |
| `tests/` | Unit, PostgreSQL/PGlite, desktop/mobile browser tests |
| `docs/baseline/` | Original deployed Worker and non-secret deployment metadata |
| `docs/DEPLOYMENT.md` | Services, variables, manual release and rollback |
| `docs/SECURITY.md` | Controls and remaining limitations |
| `docs/DATABASE.md` | Schema and migration notes |
| `docs/ANALYTICS.md` | Event definitions and example funnel queries |

The root `index.html` has moved to `web/index.html`. **Only `dist/web` is publishable. Never publish the repository root**, which now includes backend source and internal documentation. The existing production deployment remains unchanged until an approved manual cutover.

## Local checks

Use Node **24.19.0** and pnpm **11.19.0**. Versions and the dependency lockfile are committed. Only esbuild/workerd dependency install scripts are allowlisted.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm worker:check
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm check` runs lint, strict TypeScript checking, unit/database tests and a staging build. Database tests run the actual migrations in an isolated PostgreSQL WASM instance with simulated Supabase roles/auth schema. They do not contact or mutate Supabase. Browser tests mock Gemini/Turnstile/API responses and do not incur AI charges.

`pnpm build` emits a review-only staging build when no Turnstile site key is supplied. The audit button explicitly stays unavailable until configured. `pnpm build:production` rejects missing or known test site keys. Public configuration can be supplied with `PUBLIC_API_BASE_URL` and `PUBLIC_TURNSTILE_SITE_KEY`.

The build uses esbuild's portable WASM implementation and compiles Tailwind ahead of time. No CDN styling dependency or unsafe inline event handlers are shipped.

For a configured local integration test, copy `.dev.vars.example` to `.dev.vars.staging`, use a disposable staging Supabase project, configure its URL in `wrangler.jsonc`, and run `pnpm dev:api`. Build the frontend with a localhost API origin using test mode and a Turnstile test site key paired with its testing secret. Hostname/action validation is still required; mock these services for automated tests instead of bypassing production checks. To use a real staging deployment, register its exact hostname with Turnstile and use its real keys.

```sh
pnpm build:test
node scripts/serve.mjs
```

That preview alone is not a backend emulator; automated browser tests supply the mocked API.

## What remains a release task

Provision separate staging/production Supabase projects and Turnstile widgets, apply reviewed migrations, configure secret bindings, validate the real-provider flow with an authorised test PDF, and manually publish approved builds. No cloud resources, secrets, migrations or deployments are created by `install`, `build`, `check` or CI.
