# Milestone 2 staging checkpoint

Status: implementation and infrastructure validation in progress; **NO-GO for production**. The Milestone 1 production application remains unchanged at `5e1186c7ca28951d3379d31519cf75354f22f4fc`.

## Resources

- Branch: `codex/milestone-2-ingestion`, preserving all local Milestone 1 history.
- Private R2: `conduit-ingestion-staging`, Oceania placement, public access disabled. CORS permits only the new staging workspace. Incomplete multipart uploads abort after 24 hours.
- Queue `conduit-ingestion-staging`, dead-letter queue `conduit-ingestion-staging-dlq`.
- Worker `conduit-ingestion-staging`: bootstrap only until the remote container build is connected. No production routes.
- Dedicated Turnstile site key `0x4AAAAAAFBk8ViRzUGp2cW8`, restricted to `conduit-ingestion-staging.pages.dev`.
- Encrypted Worker secrets: R2 credentials scoped to this bucket only, Turnstile, processor HMAC key, and rate-limit salt. Staging database service credential still pending.
- Staging Supabase `kvujhszkrblaovnksafx`: ingestion migration applied by the connector as version `20260923223224`, corresponding to local `20260923214709_ingestion_foundation.sql`. Do not apply this migration twice. All five new tables have RLS and no browser grants. Internal RPC denies authenticated/anonymous execution; user RPC denies anonymous execution.
- Workers Paid enabled with founder approval: US$5/month base and up to US$5 initial staging overage. Configuration permits one standard-1 processor and one queue consumer. This concurrency limit is not a hard billing cap.

## Validation so far

- 119 automated TypeScript/database tests pass, including tenant boundaries, read-only roles, exact 2 GB reservation limit, lease fencing, bounded retries, idempotent completion, object lineage and cleanup grace.
- 12 existing Milestone 1 desktop/mobile browser tests pass.
- 9 native Python parser tests pass: text/drawing preparation, corrupt/fake/encrypted files, size and page limits, restricted source hosts, no preparation after invalid input.
- Local synthetic 50 MB / 100 MB / exact 250 MB PDFs each validate and prepare 12 image pages. Local preparation measured 0.282 / 0.297 / 0.375 seconds; these exclude upload/network and are not hosted performance claims. Fixtures use explicit padding to reach exact size; a diverse realistic page-content workload remains required.
- Lint, TypeScript check, isolated staging bundle, production dependency audit pass. Credential-pattern scan of 76 source files found no matches; full final scanning remains required.

## Operational semantics

Uploads travel directly to private R2. Byte quotas include reservations until confirmed cleanup. Read-only members cannot request upload mutation permissions. Resume can recover interrupted multipart initialization. Part hashes are immutable; incomplete completion can reopen safely. Queue processing is fenced by a 15-minute lease, with at most three attempts. Sources expire only after completion or an explicit failed-job retention period. Deletions deny access immediately and wait 30 minutes before physical cleanup, beyond in-flight callback deadlines. Signed URLs expire independently and are never stored in metadata or analytics.

The page processor does no Gemini calls. COMPLETED means validated/page-prepared, not tender intelligence. Numeric upload, processing, page, retry and abandonment metrics are persisted. R2 SDK operation/attempt estimates are emitted as structured logs without URLs, filenames or contents; reconcile them against Cloudflare billing.

## Remaining acceptance gates

Remote container build/deployment; database secret and invited tenant accounts; staging frontend; full hosted large-upload/resume/cancellation/security matrix; Milestone 2 browser tests; revision-selection UI; final lifecycle/failure metrics review; final parser dependency audit and secret scan. No Milestone 2 production deployment is authorized.
