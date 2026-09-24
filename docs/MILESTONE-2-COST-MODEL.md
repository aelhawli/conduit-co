# Milestone 2 ingestion cost model

25 September 2026. USD/month, excluding tax. Planning estimate, not a bill or
production capacity certification. AI inference is **$0 in this M2 ingestion model**
and must be budgeted separately for future analysis.

## Assumptions

- Average tender: 100 MB original PDFs, 100 pages, four documents, 40 MB total
  derived text/images. This is a planning mix; measured construction scans are
  reported separately, not extrapolated as a universal benchmark.
- Sources retained 30 days; derived files 90 days. At steady state storage is
  `monthly tenders × (0.10 + 3 × 0.04) GB`. First months are smaller.
- Processing 600 seconds per tender total across its documents, 200 CPU-seconds,
  plus 30 seconds idle. Add 10% processing/retry contingency: 693 instance-seconds
  and 220 CPU-seconds per tender. Sequential documents share the final idle period.
- standard-1 container: 4 GiB provisioned RAM, 8 GB disk, 0.5 vCPU capacity. CPU is
  billed for use; memory/disk while running. 220 Class A R2 operations per tender;
  Class B and queue operations remain inside listed allocations in this scenario.
- 53.3 MB container outbound traffic per tender includes base64 callback overhead.
  Assume the Oceania egress tariff conservatively; actual container placement may vary.
- Includes a $5 Workers plan and $25 Supabase Pro baseline with one Micro project.
  These are shared account/organisation costs: do not add them twice to the existing
  M1 invoice. Additional retained Supabase projects start around $10/month each.
- Included allowances assumed available once per account, not per environment.
  Staging/other applications may already consume them. R2 and DO billing-unit
  rounding is included below.

## Estimated steady-state costs

| Cost / demand | 100 tenders | 1,000 tenders | 10,000 tenders |
|---|---:|---:|---:|
| Active + idle container hours | 19.25 | 192.5 | 1,925 |
| Original + derived GB retained | 22 | 220 | 2,200 |
| Container compute above allowances | $0.47 | $10.99 | $116.46 |
| R2 storage above allowance | $0.18 | $3.15 | $32.85 |
| R2 Class A above allowance | $0 | $0 | $9.00 |
| Durable Object duration above allowance | $0 | $0 | $12.50 |
| Container outbound above allowance | $0 | $0 | $1.65 |
| Workers + Supabase baseline | $30 | $30 | $30 |
| Model subtotal | **$30.65** | **$44.14** | **$202.46** |
| Practical initial budget envelope | **$35–50** | **$50–90** | **$230–400** |

The envelope allows ordinary logging/build/Worker CPU usage and modest database
growth; it is not a guarantee. It excludes a separately priced monitoring service,
large database compute upgrades, authentication email service, paid support, PITR,
domain fees, developer labour and AI inference. Validate actual usage meters and
database load before approving a production budget. At 10,000 tenders, even 600
Worker requests/tender is 6 million requests/month; CPU and logs still need metering.

**Capacity constraint:** 1,925 instance-hours cannot fit into a 720-hour month on
the current single instance. At 60% target utilisation it needs about five equivalent
instances and routing/queue changes, with burst testing. No such scaling changes
have been made. The table estimates resource consumption after a separately reviewed
capacity change; it does not claim the staging architecture supports that volume.

Database page rows can reach roughly three million at the largest scenario with
90-day page retention. Version/job/metric metadata currently persists longer than
object retention; define its archival horizon and measure indexes/bloat. Do not
assume object cleanup makes database growth zero. New revisions and duplicate uploads
still incur processing/storage; include them in the tender totals.

## Rates and calculation sources

- [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/):
  RAM $0.0000025/GiB-second after 25 GiB-hours; CPU $0.000020/CPU-second after
  375 CPU-minutes; disk $0.00000007/GB-second after 200 GB-hours. Oceania outbound
  $0.05/GB after 500 GB. RAM/disk are provisioned, CPU is active usage.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/): Standard $0.015/GB-month,
  $4.50/million Class A, $0.36/million Class B; 10 GB / 1M A / 10M B allowances.
  Network egress is free. Source download traffic is not Supabase Storage egress.
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/):
  1M monthly operations included; then $0.40/million. Approximately three operations
  per successful small job message, plus retries.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/):
  400,000 GB-seconds included then $12.50/million; allocated 128 MB per active object.
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/):
  10M requests and 30M CPU milliseconds included on the $5 plan; overage $0.30/M
  requests and $0.02/M CPU milliseconds.
- [Supabase pricing](https://supabase.com/pricing): Pro from $25/month, 8 GB database
  disk per project then $0.125/GB, 250 GB egress then $0.09/GB, additional compute
  priced by project/size. Existing production/staging baselines remain separate from
  incremental M2 resource consumption.
