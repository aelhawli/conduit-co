# M2 production release preflight — preparation only

25 September 2026. **NOT READY TO DEPLOY. No production resource has been changed.**
Milestone 1 production remains the baseline; no Milestone 3 functionality is included.

The realistic 95.6 MB and 245.0 MB staging workloads have passed after the grayscale
reference correction. Completion of the physical-device check,
operational alert ownership and a separately reviewed production release remain gates.

| Component | Staging | Production preparation required |
|---|---|---|
| Release candidate | b629b8183a4bc5f6d3a648528fd0dcee4fbcf124 plus final evidence docs | Approve final hash after all checks |
| Frontend | ingestion-staging.pages.dev, authenticated only | Choose separate authenticated workspace hostname; preserve M1 funnel |
| API / Container | isolated staging Worker, one standard-1 instance | New production Worker/DO/container names, private binding, environment-specific egress |
| R2 | private staging bucket, exact-origin CORS, multipart cleanup | Separate private production bucket and bucket-scoped credentials; no staging secret reuse |
| Database | M2 migrations applied to staging | Review additive migrations against production schema and backups; do not apply yet |
| Identity / RLS | membership-enforced staging tenants | Invite-only production accounts, verified tenant memberships and negative RLS checks |
| Queue / DLQ | dedicated staging queues | Separate production queues, retention/retry/concurrency settings, recovery runbook |
| Turnstile | ingestion-staging hostname only | Genuine production site/secret with exact production workspace hostname |
| Secrets | six encrypted staging bindings | New production-only signing key, rate salt, R2, Turnstile and database credentials |
| Retention | 30-day source / 90-day derived | Approve policy and metadata archival horizon; verify cleanup and overdue alerts |
| Monitoring | database states and Worker metrics/logs; no alert policies | Named owner, tested alert delivery and DLQ/container/cleanup failure discovery |
| Capacity / cost | one instance, bounded validation budget | Approve pilot volume/budget; larger scale requires separate concurrency/routing validation |
| Recovery / rollback | M1 baseline preserved | Record current production Pages/Worker versions, database backup and additive rollback plan |

## Required environment reconciliation

The current M2 implementation deliberately hardcodes staging in `contracts.ts`,
database/storage guards, processor source/callback validation, container egress,
frontend authentication storage, build/deploy guard and Wrangler configuration.
It is **not a production-deployable configuration**. Copying it to production would
fail closed or use staging endpoints. Prepare and review explicit environment
parameterisation with negative crossover tests before approving any production
candidate. Do not remove isolation guards or substitute production strings in the
accepted staging build ad hoc.

## Controlled future release sequence

1. Obtain explicit production preflight/configuration approval and verify budget.
2. Record rollback targets; confirm backup/recovery status and accepted residual risks.
3. Provision separate resources and encrypted secrets without routing user traffic.
4. Review/apply approved additive migrations to the verified production target only.
5. Validate private API/container/database/storage/Turnstile connectivity and tenant isolation.
6. Approve final release candidate, routing and smoke-test/rollback procedure.
7. Only with deployment approval, expose the authenticated workspace; run desktop and
   physical mobile synthetic tests, check persistence/cleanup, and stop on critical failure.

No deployment, production migration, M1 frontend change or legacy infrastructure
change is performed by this preparation document.

