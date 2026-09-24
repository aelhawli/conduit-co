# M2 pilot operations review

25 September 2026. Staging only. No production changes.

## Current visibility

Job state, attempt count, prepared pages and a safe error code are persisted in
`ingestion_jobs`. The workspace displays terminal failures and recovery guidance.
Permanent PDF rejection is distinct from transient processor failure. Retries are
bounded and the database lease/outbox is reconciled every five minutes. Queue
messages contain a version identifier, not PDF contents.

Cloudflare Workers Logs are enabled. The stress-test revision adds numeric phase
timings, CPU and peak child RSS. A hard kill can prevent that summary; use container
exit status, request errors and expired database leases together. Logs must never
include parser exception strings, tender text, signed URLs or authentication data.

On inspection, normal queue and DLQ backlog were both zero. Cloudflare notification
policies were empty. **This is visibility, not an active alerting service.** No
notification delivery or DLQ redrive has yet been validated.

## Minimum before pilot

Assign an operational owner and backup. During an attended pilot, review the
following dashboard/SQL view every five minutes while uploads are active. Before
unattended use, connect an approved alert destination and test delivery using safe
synthetic failures. Proposed thresholds require tuning from pilot measurements:

| Signal | Suggested trigger | First response |
|---|---|---|
| New terminal processing failure | Any unexpected FAILED job | Check safe error code and attempt; permanent input rejection is not infrastructure failure |
| DLQ | Backlog > 0 | Inspect message IDs and associated jobs; do not purge blindly |
| Queue backlog | Oldest waiting job > 10 minutes or increasing for 15 minutes | Check consumer/container health and capacity |
| Container | OOM, exit, timeout or repeated 5xx | Check bounded resource metrics and lease recovery; preserve sources |
| Stuck processing | Lease expired by > 5 minutes | Verify cron/outbox operation before manual intervention |
| Cleanup | Cleanup retry, or overdue deletion > 15 minutes after its 30-minute grace | Inspect storage permission and lifecycle task; retry remains idempotent |
| Storage growth | > 20% above retention model, or stale multipart > 24 hours | Reconcile live versions, derived prefixes and abandoned sessions |
| Spend | 50%, 80%, 100% of approved pilot budget | Review actual invoice meters; stop synthetic load before increasing spend |

Cloudflare locations: Workers & Pages → ingestion Worker → Observability;
Compute → Containers → processor → logs/metrics; Queues → normal queue / DLQ →
metrics/messages; R2 → private bucket → metrics/lifecycle. Use the database query
below alongside these surfaces: an empty DLQ does not imply all jobs succeeded.
The application catches processor errors and records them in the database, so
many failures will never appear in the DLQ.

## Read-only database view

Run only in the intended environment; this review targets conduit-staging.

```sql
select id, version_id, state, attempt, pages_prepared, error_code,
       retryable, lease_until, next_attempt_at
from public.ingestion_jobs
where state = 'FAILED'
   or (state not in ('COMPLETED','CANCELLED')
       and (lease_until < now() - interval '5 minutes'
            or next_attempt_at < now() - interval '10 minutes'));

select id, state, delete_requested_at, source_retain_until, derived_retain_until
from public.document_versions
where deleted_at is null and (
  delete_requested_at < now() - interval '45 minutes'
  or (source_deleted_at is null and source_retain_until < now() - interval '15 minutes')
  or derived_retain_until < now() - interval '15 minutes');
```

## Recovery procedure

1. Confirm environment and preserve the affected version/source. Record IDs and
   safe error codes only. Do not expose object links or tender contents.
2. Repair the underlying transient service/permission fault. Do not retry encrypted,
   corrupt, oversized or unsupported files without a corrected source.
3. For an eligible pending/retryable database job, let the reconciler redeliver it.
   A duplicate queue delivery cannot claim a completed/cancelled job or active lease.
4. For DLQ entries, compare the version with its database job before redrive. Replay
   only the validated version ID to the same environment's main queue. Verify the
   resulting state before acknowledging the DLQ message. A terminal FAILED job is
   not automatically reset by redrive; re-upload a corrected source or use a reviewed
   operator recovery change, never an ad hoc blanket attempt reset.
5. Confirm exactly one job per version, unique page numbers, fenced lineage and no
   unexpected derived prefixes. Recheck cleanup after the next cron cycle.

Do not increase concurrency merely to clear backlog: the current single container
and one consumer are deliberate staging cost/resource bounds. Production capacity
requires a separate load and deployment review.

