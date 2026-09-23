# Milestone 2 staging checkpoint

Status: implementation and infrastructure validation in progress; **NO-GO for production**. The Milestone 1 production application remains unchanged at `5e1186c7ca28951d3379d31519cf75354f22f4fc`.

## Resources

- Branch: `codex/milestone-2-ingestion`, preserving all local Milestone 1 history.
- Private R2: `conduit-ingestion-staging`, Oceania placement, public access disabled. CORS permits only the new staging workspace. Incomplete multipart uploads abort after 24 hours.
- Queue `conduit-ingestion-staging`, dead-letter queue `conduit-ingestion-staging-dlq`.
- Worker `conduit-ingestion-staging` and private processor container are deployed through guarded remote builds from `codex/milestone-2-ingestion`. No production routes. Separate frontend: https://conduit-ingestion-staging.pages.dev. Preview builds are disabled. Production Pages auto-deployment remains disabled.
- Dedicated Turnstile site key `0x4AAAAAAFBk8ViRzUGp2cW8`, restricted to `conduit-ingestion-staging.pages.dev`.
- Encrypted Worker secrets: R2 credentials scoped to this bucket only, Turnstile, processor HMAC key, and rate-limit salt. Staging database service credential is encrypted in this Worker. No production credentials are used.
- Staging Supabase `kvujhszkrblaovnksafx`: ingestion migration applied by the connector as version `20260923223224`, corresponding to local `20260923214709_ingestion_foundation.sql`. Do not apply this migration twice. All five new tables have RLS and no browser grants. Internal RPC denies authenticated/anonymous execution; user RPC denies anonymous execution.
- Workers Paid enabled with founder approval: US$5/month base and up to US$5 initial staging overage. Configuration permits one standard-1 processor and one queue consumer. This concurrency limit is not a hard billing cap.

## Validation so far

- 120 automated TypeScript/database/transport tests pass, including tenant boundaries, read-only roles, exact 2 GB reservation limit, lease fencing, bounded retries, idempotent completion, object lineage and cleanup grace.
- 12 existing Milestone 1 desktop/mobile browser tests pass. Six new ingestion desktop/mobile tests pass against mocked services; they do not substitute for hosted acceptance.
- Nine parser tests also pass inside the remotely built Linux image. Pinned Python dependencies and production JavaScript dependency audit report no known vulnerabilities.
- Real hosted authentication, organisation membership and tender creation pass. Tenant A and B test accounts belong to separate synthetic organisations. Anonymous API access returns 401, unauthenticated processor callbacks 403, production/unrelated CORS origins 403 without allow-origin, and the dedicated staging preflight returns 204.
- First real upload is waiting on human Turnstile verification. No hosted large-upload result is claimed yet. Anonymous REST reads of all five ingestion tables and calls to both RPCs return 401. A credential-pattern scan of 79 source/build/documentation files has no findings; final Git-history/archive scans remain pending.
- 9 native Python parser tests pass: text/drawing preparation, corrupt/fake/encrypted files, size and page limits, restricted source hosts, no preparation after invalid input.
- Local synthetic 50 MB / 100 MB / exact 250 MB PDFs each validate and prepare 12 image pages. Local preparation measured 0.282 / 0.297 / 0.375 seconds; these exclude upload/network and are not hosted performance claims. Fixtures use explicit padding to reach exact size; a diverse realistic page-content workload remains required.
- Lint, TypeScript check, isolated staging bundle, production dependency audit pass. Credential-pattern scan of 76 source files found no matches; full final scanning remains required.

## Runtime findings

The first remote deployment was rejected before activation because the Node-target bundle selected the AWS SDK Node HTTP transport. The staging bundle now uses the browser/fetch-compatible SDK resolution. The first authenticated request then exposed a native fetch receiver TypeError; the database wrapper now preserves the global receiver, with a regression test. Hosted organisation loading and tender creation subsequently succeeded. Diagnostics record only bounded stage/error codes, never request bodies, credentials or provider response strings.

A second 50 MB synthetic fixture contains 63 image pages (49,545,216 image bytes), supplementing the padded boundary fixtures. All 63 pages validate and prepare locally in 1.782 seconds; this is not a hosted processing measurement.

## Operational semantics

Uploads travel directly to private R2. Byte quotas include reservations until confirmed cleanup. Read-only members cannot request upload mutation permissions. Resume can recover interrupted multipart initialization. Part hashes are immutable; incomplete completion can reopen safely. Queue processing is fenced by a 15-minute lease, with at most three attempts. Sources expire only after completion or an explicit failed-job retention period. Deletions deny access immediately and wait 30 minutes before physical cleanup, beyond in-flight callback deadlines. Signed URLs expire independently and are never stored in metadata or analytics.

The page processor does no Gemini calls. COMPLETED means validated/page-prepared, not tender intelligence. Numeric upload, processing, page, retry and abandonment metrics are persisted. R2 SDK operation/attempt estimates are emitted as structured logs without URLs, filenames or contents; reconcile them against Cloudflare billing.

## Remaining acceptance gates

Full hosted small/large/multiple upload, resume, revision, cancellation, tenant-isolation and security matrix; final lifecycle/failure metrics review; final secret scan. Revision-selection UI is implemented and awaiting hosted validation. Remote build token is dedicated to staging but carries Cloudflare’s broad default account deployment scopes, explicitly approved by the founder; the deploy script validates the staging target. Remove the temporary local GitHub CLI login after publishing is complete. No Milestone 2 production deployment is authorized.
