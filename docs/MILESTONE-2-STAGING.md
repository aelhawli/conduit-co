# Milestone 2 staging validation report

24 September 2026. Staging-only document ingestion foundation. Production remains unchanged at `5e1186c7ca28951d3379d31519cf75354f22f4fc`; no Milestone 3 functionality or Gemini analysis was added. Final checkpoint and deployment IDs are recorded in the accompanying release manifest.

**Recommendation: CONDITIONAL GO for a controlled, authenticated pilot after a separately approved production infrastructure/release preflight. Not an unrestricted launch recommendation or authorization to deploy.** The hosted functional matrix passes subject to the explicitly stated test limits below.

Staging: https://conduit-ingestion-staging.pages.dev
API: https://conduit-ingestion-staging.letstalk-531.workers.dev
Branch: `codex/milestone-2-ingestion`.

## Architecture and resources

The existing M1 funnel is preserved. The new invite-only workspace uses Supabase Auth and database organisation membership. A small authenticated Worker control API reserves quota and issues scoped storage permissions. Original PDFs travel directly from the browser to private R2 using 8 MiB multipart chunks. A durable database job/outbox, Cloudflare Queue and private PDF-processing Container validate and prepare pages independently of the browser. A five-minute reconciliation schedule recovers dispatch and performs cleanup. No originals are base64-proxied through the application Worker. Small derived images may traverse authenticated processor callbacks.

| Resource | Staging configuration |
|---|---|
| Pages | `conduit-ingestion-staging`; no custom domains; previews disabled |
| Worker | `conduit-ingestion-staging`; staging-only guard; no production routes |
| R2 | `conduit-ingestion-staging`, Oceania placement, Standard storage |
| Queue / DLQ | `conduit-ingestion-staging` / `conduit-ingestion-staging-dlq` |
| Private Container | `PdfProcessor`, standard-1, maximum one instance, one queue consumer, 30-second idle sleep |
| Database | Existing `conduit-staging`, `kvujhszkrblaovnksafx`; no new database project |
| Turnstile | Dedicated managed site, domain restricted to ingestion staging, `audit` action |
| Build | Cloudflare remote Docker builds from this staging branch; guarded staging deployment command |

R2 public access is disabled and there are no custom bucket domains. CORS permits only the ingestion staging origin. Upload permissions bind one object/version, part number, MD5 and exact part length; expiry is ten minutes. Original download links expire after 60 seconds; processor grants last 15 minutes. Keys contain unpredictable IDs, not customer filenames. Incomplete multipart uploads also have a 24-hour R2 abort lifecycle. Sources and derived files use separate prefixes.

The Container has no general internet access: egress is restricted to the staging R2 endpoint and ingestion API. Processing uses pinned pikepdf/PDFium dependencies in a non-root child process with memory, file, CPU and time bounds. Maximums include 2,000 pages, page dimensions and per-page output limits. Processing leases fence stale callbacks and permit at most three claims. Permanent PDF validation failures are not retried.

## Schema and migrations

Organisation -> project -> document -> immutable document version. Added `document_versions`, `upload_sessions`, `ingestion_jobs`, `document_pages`, `ingestion_metrics`, plus additive project deletion metadata. Rows capture size, checksum, type, source key, lineage, states, timestamps, page dimensions, text/image references and numeric operational metrics. Five new tables have RLS and no direct browser/service-role table grants. Restricted user/internal RPCs enforce identity, membership and role boundaries. User-editable metadata does not grant membership.

| Local migration | Applied staging version |
|---|---|
| `20260923214709_ingestion_foundation.sql` | `20260923223224` |
| `20260923231853_ingestion_cleanup_metrics.sql` | `20260923232700` |

Both approved M1 migrations remain present. The follow-up migration scrubs the parent filename after its last revision is cleaned, counts server-observed transfer failures once per version, and records expired-lease retries. No production migration was applied for M2.

## Hosted upload and preparation results

All completed valid submissions below succeeded on their first processing attempt. Durations are server-recorded elapsed times, not isolated throughput benchmarks.

| Test | Bytes | Pages | Upload seconds | Processing seconds | Result |
|---|---:|---:|---:|---:|---|
| Initial small PDF | 1,446 | 3 | 486.140* | 11.284 | PASS |
| Content-heavy image PDF | 50,000,000 | 63 | 16.686 | 172.357 | PASS |
| 100 MB boundary PDF | 100,000,000 | 12 | 65.278** | 37.704 | PASS |
| 250 MB boundary PDF | 250,000,000 | 12 | 145.324 | 41.567 | PASS |
| Hosted mobile drawings | 2,123 | 6 | 3.991 | 16.729 | PASS |
| Revision / duplicate source | 2,123 | 6 | 3.905 | 16.714 | PASS |
| Two-file batch: drawings | 2,123 | 6 | 3.867 | 15.990 | PASS |
| Two-file batch: text PDF | 1,446 | 3 | 3.860 | 6.392 | PASS |

* Initial small-file upload timing includes debugging pauses and is not representative. ** 100 MB timing includes an intentional pause, reload and resume. The 100/250 MB fixtures contain padding around twelve image pages: they validate transport/size boundaries, not processing throughput for equally large complex tender drawings. The 50 MB fixture contains 63 unique image pages and 49,545,216 bytes of image data.

- **Multi-file:** a selected 100/250 MB batch and a separate two-small-PDF batch completed. Each file retains independent durable state. Turnstile can require interaction between files; processing continues while the next file uploads.
- **Interruption/resume:** paused 100 MB after ten confirmed parts (83,886,080 bytes), refreshed, reselected the same file and completed under the same version. Confirmed chunks were skipped and hashes checked. Browser re-selection is required after closure; local file permission is not silently retained.
- **Refresh/recovery:** refreshed during desktop 50 MB processing and mobile drawing preparation; backend jobs continued and the correct completed state reappeared.
- **Checksums:** full server SHA-256 matched local originals for small, 50 MB, 100 MB, 250 MB and drawing PDFs. Multipart chunks also use signed MD5/size constraints. The 250 MB hash is `e98ad54b2ba18e28e2351721e30436aada36668020a47bf0aa30d54fe59a1938`.
- **Preparation:** text pages have extracted text references; image-only pages have rendered PNG references; every prepared page has positive dimensions and version/page lineage. The 50 MB file produced 63 prepared page records and 63 image references. This is preparation, not AI analysis or document classification.
- **Revision/duplicate:** version 2 remained attached to the same document, its source checksum matched version 1, and `duplicate_of` correctly referenced version 1. The UI labels it. Intentional versions remain separate; this is detection rather than storage deduplication.
- **No accidental duplication:** hosted queries found no duplicate processing jobs, page primary keys or single-occurrence lifecycle metrics. Deliberately repeated invalid submissions and an intentional document revision are separate attempts, not retry-created duplicates.
- **Desktop/mobile:** real hosted desktop uploads and a 390x844 responsive browser upload passed. Mobile document width was 375 CSS pixels, within the viewport. This was browser viewport testing on Windows, not physical iOS/Android hardware.

## Negative and security checks

Fake PDF, truncated/corrupt PDF and encrypted PDF were rejected on attempt one, with zero prepared pages. The UI now explains recovery in plain language. Unsupported extension and 250,000,001-byte file were rejected by the hosted browser without new reservations. Hosted authenticated-role SQL separately rejected an oversized file, accepted exactly eight 250 MB reservations and rejected the next byte over 2 GB; the transaction was rolled back. No claim is made that 2 GB was physically transferred in one project.

Tenant B could not open Tenant A's tender in the browser. Hosted authenticated-role SQL denied cross-tenant project/version reads, reservations, upload mutations, cancellation, deletion and internal RPC execution. A temporary viewer membership permitted reads but denied writes; the test membership was rolled back. Anonymous reads of all five new tables and RPC calls were denied. Browser JWT authentication and database membership are separate checks.

Production, M1-staging and unrelated origins were denied by the M2 API; the dedicated staging preflight passed. Forged processor callbacks were denied. Unsigned R2 access returned HTTP 400 with XML `InvalidArgument: Authorization`, never a PDF. A bounded 125-request unauthenticated check observed 105 HTTP 401 and 20 HTTP 429 responses; counters include existing requests and are not a precise global cutoff claim.

All six Worker secrets are encrypted: scoped R2 access/secret keys, staging database service key, Turnstile secret, processor HMAC key and rate-limit salt. No production keys are reused. Frontend assets reference only M2 staging API/database. Query strings are redacted in Worker logs; application logs contain bounded IDs/states/operation counts, not contents or signed URLs. A 100-event sample including 14 application logs had zero credential/signed-URL pattern matches. Source/build/Git/output scans had zero unresolved findings after synthetic test literals were classified. Pattern scans cannot prove absence of every possible credential format.

## Cleanup and retention

Default retention is exactly 30 days for completed source PDFs and 90 days for derived output, measured from successful completion. Failed validation artifacts expire after 24 hours; exhausted lease recovery has a bounded seven-day fallback. Processing failures do not trigger an early normal-success source expiry. Upload reservations count toward quota until cleanup completes.

Deletion stops new access immediately and uses a 30-minute physical cleanup grace. The actual scheduled Worker removed a cancelled small PDF and three text objects, cleared page/multipart records and scrubbed both version and parent filenames. Whole-project deletion removed its two sources, all derived objects and page records, and hid the project.

A real R2 multipart session was created then paused before its first part. Its expiry and cleanup grace were accelerated only on that disposable record. Reconciliation recorded exactly one `abandoned_upload`, and the scheduled Worker aborted the multipart upload and cleared its metadata. Global lifecycle/grace settings were not shortened.

Source-only expiry passed: the scheduled Worker deleted the 50 MB original while retaining all 63 page records and 126 derived objects. Full derived-retention expiry passed: the 100 MB version has no source, derived objects or page records remaining. These checks used completed synthetic records with individually accelerated timestamps, not a 30/90-day elapsed soak. Global retention stayed unchanged. No production or customer records were used.

## Tests and fixes

128 TypeScript/database tests, 12 M1 desktop/mobile browser regressions, 12 M2 desktop/mobile browser tests, nine Python parser tests and the native workerd SDK fetch/XML test pass. Browser regression tests mock services; they supplement the real hosted cases above. Lint and type checking pass. JavaScript production and pinned Python dependency audits report no known vulnerabilities.

The deletion-race regression was also checked against the old behavior: it failed as expected without the guard, then passed with the guard restored.

Staging findings fixed during implementation: AWS SDK Worker transport/XML compatibility, native fetch receiver binding, explicit error statuses, retention configuration, cleanup privacy/metrics, useful failure messages, access-denied handling, and late project responses after deletion. The final UI correction ignores obsolete refresh results so a deleted tender cannot reopen or display a spurious connectivity error. These changes are confined to M2. No broad live production debugging or deployment occurred.

## Cost and remaining conditions

After controlled cleanup, R2 contained 250,008,164 source bytes and 52,316,375 derived bytes (about 302 MB total).

Workers Paid has the approved US$5/month base; the founder approved up to US$5 initial staging overage. Existing Supabase Pro is reused without another project. Standard R2 storage is US$0.015/GB-month before included allowances: 2 GB of source retained for a full month is about US$0.03, plus derived storage/operations. Free allowances are account-wide. Container standard-1 is 0.5 vCPU, 4 GiB RAM, 8 GB disk. At full CPU the published compute/storage rates total about US$0.00002056 per running second before allowances, about US$0.0042 for the 172-second job plus 30 seconds idle. These are estimates, not bills; Worker/DO/queue/build/log/egress charges are additional. There are no Gemini charges from M2.

Pricing: https://developers.cloudflare.com/containers/platform/pricing/ and https://developers.cloudflare.com/r2/pricing/ (reviewed 24 September 2026).

Conditions before a wider production release:
1. Provision and verify separate M2 production storage, secrets, queues/container, Auth onboarding and additive migrations through an approved production release plan. The current deployment deliberately refuses production targets.
2. Test content-heavy 100/250 MB construction-like packages and physical low-memory mobile devices before advertising these maximums. The single processor and 600-second job deadline bound work and throughput; high-page-count packages remain a capacity risk.
3. Review real account billing, monitoring and DLQ response. One container is a concurrency limit, not a dollar cap. Cloudflare's remote-build token has broad account deployment scopes, explicitly approved; narrow it where supported before production automation.
4. `upload_failed` measures server-observed initiation/completion failures once per version. Browser-only/offline interruptions are represented by resume/abandonment state, not a complete client-failure telemetry stream. R2 log operation counts are SDK estimates and exclude direct browser PUT counts; reconcile with provider usage.
5. Synthetic QA users/data remain in staging for review. Passwords were generated only in ephemeral browser-control memory, which restarted; do not treat these accounts as founder production onboarding. Remove test identities/data when the pilot is accepted, using an approved cleanup. Old lease-derived objects are removed by version cleanup rather than immediately after each retry.

The M1 acquisition funnel remains the production entry point. A future approved M2 release should introduce an opt-in authenticated workspace; lead email alone must never establish tenant ownership. Full tender intelligence and takeoffs remain Milestone 3 and were not started.
