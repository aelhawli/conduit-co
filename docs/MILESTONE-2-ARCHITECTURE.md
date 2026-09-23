# Milestone 2 architecture and implementation plan

Prepared before implementation, 24 September 2026. Approved production baseline:5e1186c7ca28951d3379d31519cf75354f22f4fc. Milestone1 is closed. This plan authorizes no production deployment.

## Existing architecture audit

The existing TypeScript Worker accepts one base64 PDF up to7MiB, validates its envelope, verifies Turnstile, performs synchronous Gemini analysis with bounded retries, and stores the audit/lead/funnel events through restricted Supabase RPCs. The static Pages funnel is working in production. It has no authenticated tenant workspace, object storage, upload session, background consumer, robust PDF parser or page index.

The16-table foundation includes users, organisations, memberships, projects and documents with composite organisation foreign keys. These entities are schema-only and all direct API table grants are revoked. Staging has zero auth users, organisations, memberships and projects at audit time. Existing documents combine identity/version fields; explicit immutable document versions and separate ingestion jobs are needed. Existing free-audit jobs/events must retain their contracts.

## Proposed architecture

Add a separate staging-only tender workspace and ingestion Worker; preserve the existing M1 frontend/Worker unchanged. Supabase Auth identifies users; database membership and roles authorize every project/document/job operation. Auth claims from editable user_metadata never grant access. Use an invite-only staging pilot with two isolated test organisations. No implicit public signup or tenant assignment.

Browser -> authenticated control API -> transactional Supabase metadata/quota reservation. Browser -> private R2 S3 endpoint directly for signed multipart UploadPart requests. Originals never traverse the application Worker. Use8MiB parts, limited parallelism, signed exact part size and content digest, ten-minute expiry, unpredictable organisation/project/document/version IDs. Only the control plane creates, lists, completes and aborts multipart uploads. Complete verifies authoritative R2 part sizes/order and HEAD metadata. Duplicate requests reuse a client idempotency key. Retries cannot reserve project quota twice.

Use decimal engineering limits250,000,000bytes/file and2,000,000,000bytes/project, including active reservations and retained versions. These remain staging targets until hosted boundary tests pass. Upload progress comes from XMLHttpRequest bytes plus confirmed uploaded parts. On reload, server multipart state is authoritative; users reselect the same local file, verified with chunk hashes, because browsers cannot silently reacquire files after closure. Cancel and delete revoke future signing immediately; issued part URLs expire shortly and incomplete uploads are aborted.

Database jobs/outbox persist independently of the browser. Cloudflare Queue provides at-least-once delivery; leases and fencing tokens make processing idempotent. Reconciliation sweeps recover missed queue sends and expired leases. Bounded retries distinguish transport/processor failures from permanent PDF rejection. DLQ/stalled jobs surface explicit failure, never permanent spinners.

PDF parsing uses a private Cloudflare Container, not the128MiB Worker heap. Download source to bounded ephemeral disk with a short-lived GET grant; verify full SHA-256, file magic, actual size, encryption, structural integrity, page count and page dimensions. Reject corrupt, encrypted and malformed PDFs before any AI work. Parse in a resource-limited child process with deadline/page/pixel/output caps. Native parser warnings that imply repair are treated as invalid, not silently accepted. No Gemini analysis is implemented inM2.

Process pages incrementally. Persist original document/version and one-based page number, dimensions, available text and derived image reference for image-only pages. Use fenced/idempotent page writes and tenant-scoped object paths. Renderer gets job-specific access only, no production credentials. Persist progress only after work is durably committed; COMPLETED means ingestion/indexing finished, not tender intelligence. User-facing stages: upload, validation, preparation, ready. Do not display fictional analysis steps.

## Staging resources

Proposed names: Pages conduit-ingestion-staging; Worker conduit-ingestion-staging; R2 conduit-ingestion-staging (private, no r2.dev/custom public domain); Queue conduit-ingestion-staging plus conduit-ingestion-staging-dlq; private processor Container/DO binding; staging Supabase kvujhszkrblaovnksafx. Dedicated rate limiter namespaces and staging-only CORS. No production resources or secrets copied.

Secrets: bucket-scoped R2 access key/secret in encrypted ingestion Worker bindings; staging Supabase service-role key for internal fenced processing only; staging publishable key in browser; staging Turnstile secret in Worker; internal processor authorization as encrypted bindings. Signed URLs, access tokens, filenames, document contents and native parser exception strings must never enter logs/analytics. Durable state stores object keys, not signed URLs.

## Schema/migrations

Add immutable document_versions, upload_sessions/parts, ingestion_jobs, document_pages and numeric ingestion_metrics; reuse organisations/memberships/projects/document identities. Add transactional project reservation accounting and deletion/retention metadata. Composite FKs include organisation/project/document lineage, preventing cross-project revision links. Tenant read policies use persisted memberships. Narrow mutation RPCs validate role, ownership, idempotency and legal state transitions; revoke default PUBLIC execution. Internal processor RPCs require service_role and a current lease fence. No changes to M1 lead/audit RPC semantics.

State concepts: UPLOADING -> UPLOADED -> VALIDATING -> PROCESSING -> COMPLETED, with FAILED/CANCELLED terminal handling and controlled retries. Separate upload/validation/processing errors and retry counters. Claims, renewals, completion and cleanup use compare-and-set transitions. Quota release occurs exactly once after abort/delete reconciliation.

## Lifecycle and observability

Abort abandoned multipart uploads after24hours, with R2 lifecycle as a safety net. Remove rejected/quarantined source objects after24hours. Successful sources default to30days after successful preparation; derived artifacts default90days. Configuration is explicit, and deletion must never expire sources solely from initial upload time before processing success. A failed processing job retains source for retry until the configured failed-job/manual-review deadline. Project/document deletion first denies access/cancels jobs, then asynchronous idempotent cleanup removes source, derived data and metadata. Database backup retention is a separate limit on physical erasure and must be disclosed.

Numeric metrics: reserved/actual bytes, upload time, processing time, page count, R2 request counts, failure codes, retries, abandoned sessions and queue lag. All attributable to tenant/project/job for future cost accounting, with no tender contents or signed URL values. R2 attempt counters are operational estimates reconciled with provider billing, not invoices.

## Costs and technical risks

Official R2 Standard rates checked:US$0.015/GB-month, ClassA$4.50/million, ClassB$0.36/million, no internet egress charge.2GB retained for a month is approximately$0.03 of source storage before free allowances;100 such tenders≈$3/month, excluding derived images. A250MB upload needs30 parts at8MiB, plus initiate/list/complete/read/cleanup operations. Rendering can dominate storage; enforce page/pixel caps and measure actual output.

Containers require Workers Paid ($5/month base). Published overage rates:memory$0.0000025/GiB-second, activeCPU$0.000020/vCPU-second, provisioned disk$0.00000007/GB-second, plus region-specific container egress and Workers/DO/Queue charges. Example standard-1 (4GiB,0.5vCPU,8GB disk), active for60seconds at fullCPU:about$0.00123 before included allowances/other services. This is an illustrative estimate, not measured tender performance or a hard spending cap. Bound staging to one processor instance and small queue concurrency. Existing Supabase Pro project incurs incremental database/storage/egress usage; no extra project planned.

Risks: native PDF parser attack surface, compression/image bombs, large-file mobile memory, signed URL reuse until expiry, cancellation races, multipart completion uncertainty, queue duplicate delivery, quota races, recoverability after browser closure and parser timeouts. Test each explicitly. Protect originals with completion freezing and verified hashes; incomplete multipart must never be admitted as a valid document.

Current provisioning constraints: connected Cloudflare API rejects R2/Containers/subscriptions requests; no local Docker executable was found. These are infrastructure access/build prerequisites to resolve, not reasons to shrink the250MB target or pretend local tests prove hosted readiness. Cloudflare supports container builds through an appropriate build environment; choose a supported path after account verification.

## Internal implementation stages

1. Preserve closedM1 baseline; isolateM2 branch/config/build and commit this audit/design.
2. Tenant auth, additive schema, atomic quota/version/job APIs and adversarial SQL tests.
3. Private R2 multipart signing/control plane, resume/cancel/reconcile and transport tests.
4. Bounded native validation/page preparation, durable queue/lease/retry/deletion processing and parser fixtures.
5. Authenticated staging workspace with real upload bytes, persistent jobs and explicit recovery UX.
6. Provision staging; run hosted matrix:small/50MB/100MB/250MB, multiple files, interruption/resume, duplicate, fake/invalid/corrupt/encrypted, file/project boundaries, cross-tenant access, refresh and mobile. Use generated nonconfidential PDFs only.
7. FullM1/M2 regression, security/secret/dependency scans, cost observations and release report. Production remains untouched. Any missing hosted gate means NO-GO or explicit CONDITIONAL GO; no fabricated success.

Migration path: opt-in staging workspace first; later approved release can link existing leads to authenticated organisation projects. Do not silently migrate anonymous audits, replace the production upload, or interpret a lead email as ownership. M3 intelligence/takeoffs remain out of scope.

Sources: https://developers.cloudflare.com/r2/api/s3/presigned-urls/ ; https://developers.cloudflare.com/r2/pricing/ ; https://developers.cloudflare.com/r2/buckets/object-lifecycles/ ; https://developers.cloudflare.com/containers/get-started/ ; https://developers.cloudflare.com/containers/platform/pricing/ ; https://developers.cloudflare.com/queues/configuration/batching-retries/ ; https://supabase.com/changelog.md ; https://supabase.com/docs/guides/auth/users . Changelog reviewed: explicit API grants and current auth checks apply; no Realtime schema mutation is planned.
