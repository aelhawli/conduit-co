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

- 128 automated TypeScript/database/transport tests pass, including tenant boundaries, read-only roles, exact 2 GB reservation limit, lease fencing, bounded retries, idempotent completion, object lineage and cleanup grace.
- 12 existing Milestone 1 desktop/mobile browser tests pass. Eight new ingestion desktop/mobile tests pass against mocked services; they do not substitute for hosted acceptance.
- Nine parser tests also pass inside the remotely built Linux image. Pinned Python dependencies and production JavaScript dependency audit report no known vulnerabilities.
- Real hosted authentication, organisation membership and tender creation pass. Tenant A and B test accounts belong to separate synthetic organisations. Anonymous API access returns 401, unauthenticated processor callbacks 403, production/unrelated CORS origins 403 without allow-origin, and the dedicated staging preflight returns 204.
- Hosted small, 50 MB, 100 MB and 250 MB uploads completed on their first processing attempts. The 100 MB upload was paused after ten confirmed 8 MiB parts, reloaded and resumed under the same version. Browser refresh during 50 MB processing preserved the job. Fake, corrupt and encrypted files were rejected with zero prepared pages. Anonymous REST reads of all five ingestion tables and calls to both RPCs return 401. A credential-pattern scan of 79 source/build/documentation files has no findings; final Git-history/archive scans remain pending.
- 9 native Python parser tests pass: text/drawing preparation, corrupt/fake/encrypted files, size and page limits, restricted source hosts, no preparation after invalid input.
- Local synthetic 50 MB / 100 MB / exact 250 MB PDFs each validate and prepare 12 image pages. Local preparation measured 0.282 / 0.297 / 0.375 seconds; these exclude upload/network and are not hosted performance claims. Fixtures use explicit padding to reach exact size; a diverse realistic page-content workload remains required.
- Lint, TypeScript check, isolated staging bundle, production dependency audit pass. Credential-pattern scan of 76 source files found no matches; full final scanning remains required.

## Runtime findings

The first remote deployment was rejected before activation because the Node-target bundle selected the AWS SDK Node HTTP transport. The staging bundle now uses Node ESM resolution for the server XML parser plus an explicit FetchHttpHandler and stream collector. A real Miniflare/workerd test verifies fetch transport and XML parsing; browser-target resolution was insufficient because Workers has no DOMParser. The first authenticated request then exposed a native fetch receiver TypeError; the database wrapper now preserves the global receiver, with a regression test. Hosted organisation loading and tender creation subsequently succeeded. Diagnostics record only bounded stage/error codes, never request bodies, credentials or provider response strings.

A second 50 MB synthetic fixture contains 63 image pages (49,545,216 image bytes), supplementing the padded boundary fixtures. All 63 pages validate and prepare locally in 1.782 seconds; this is not a hosted processing measurement.

## Operational semantics

Uploads travel directly to private R2. Byte quotas include reservations until confirmed cleanup. Read-only members cannot request upload mutation permissions. Resume can recover interrupted multipart initialization. Part hashes are immutable; incomplete completion can reopen safely. Queue processing is fenced by a 15-minute lease, with at most three attempts. Sources expire only after completion or an explicit failed-job retention period. Deletions deny access immediately and wait 30 minutes before physical cleanup, beyond in-flight callback deadlines. Signed URLs expire independently and are never stored in metadata or analytics.

The page processor does no Gemini calls. COMPLETED means validated/page-prepared, not tender intelligence. Numeric upload, processing, page, retry and abandonment metrics are persisted. R2 SDK operation/attempt estimates are emitted as structured logs without URLs, filenames or contents; reconcile them against Cloudflare billing.

## Remaining acceptance gates

Full hosted small/large/multiple upload, resume, revision, cancellation, tenant-isolation and security matrix; final lifecycle/failure metrics review; final secret scan. Revision-selection UI is implemented and awaiting hosted validation. Remote build token is dedicated to staging but carries Cloudflare’s broad default account deployment scopes, explicitly approved by the founder; the deploy script validates the staging target. Remove the temporary local GitHub CLI login after publishing is complete. No Milestone 2 production deployment is authorized.

## Hosted measurements — 24 September 2026

| Fixture | Actual bytes | Pages | Upload ms | Processing ms | Attempts | Result |
|---|---:|---:|---:|---:|---:|---|
| Small synthetic | 1,446 | 3 | 486,140 | 11,284 | 1 | COMPLETED |
| Content-heavy image PDF | 50,000,000 | 63 | 16,686 | 172,357 | 1 | COMPLETED |
| Padded boundary PDF | 100,000,000 | 12 | 65,278 | 37,704 | 1 | COMPLETED |
| Padded boundary PDF | 250,000,000 | 12 | 145,324 | 41,567 | 1 | COMPLETED |

Small-file upload timing includes earlier debugging pauses; 100 MB timing includes deliberate pause/reload/resume. These are elapsed reservation-to-receipt measurements, not pure transfer bandwidth. The 100/250 MB fixtures validate transport boundaries and contain padding; they do not establish performance for 250 MB of complex drawings. The 50 MB fixture contains 49,545,216 bytes of image content. All prepared page dimensions are positive; image references exist for all image pages. The full 250 MB server SHA-256 matches the local original: `e98ad54b2ba18e28e2351721e30436aada36668020a47bf0aa30d54fe59a1938`.

Follow-up migration local `20260923231853_ingestion_cleanup_metrics.sql` applied to staging as `20260923232700`. It removes the parent filename after the last version is cleaned, counts observed server-side multipart initiation/completion failures once per version, and records expired-lease retries. Client-only network interruptions are not counted as server-observed upload failures. Explicit source/derived retention configuration is 30/90 days. Control input errors preserve permanent 400/413 responses. The UI explains invalid/encrypted/corrupt recovery and distinguishes completed upload from processing. Query-string log redaction is enabled.
