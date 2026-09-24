# Milestone 2 realistic construction stress validation

25 September 2026. **CONDITIONAL GO for M2 staging validation; production is not
ready to deploy.** No production deployment, production database change or M3 work.

Staging: https://conduit-ingestion-staging.pages.dev

Tested application commit: `b629b8183a4bc5f6d3a648528fd0dcee4fbcf124`.
Worker version `89a5a227-fe9c-40e0-8bcc-bc92b7c68635`; Pages deployment
`7629ea83-99d6-4b46-8848-963118b9df6c`.

## Hosted results

All six PDFs completed on their first processing attempt: **104 pages, zero final
failures and zero processing retries** after the fix. Source SHA-256 checksums and
actual byte sizes matched local fixtures. No duplicate page numbers or jobs were
observed. The architecture file waited 87.4 seconds behind the large package, then
completed; the normal queue reported one waiting message during that interval.

| Package | Actual size | Pages | Upload | Processing total | Strict validation | SHA-256 elapsed | Page preparation | Peak child RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ~100 MB construction | 95.60 MB | 27 | 36.27 s | 139.88 s | 2.47 s | 0.075 s | 130.49 s | 221.73 MiB |
| ~250 MB construction | 245.04 MB | 73 | 65.71 s | 346.57 s | 9.66 s | 0.326 s | 331.39 s | 377.24 MiB |
| Architectural | 4.35 MB | 1 | 4.58 s | 8.43 s | 0.088 s | 0.003 s | 6.58 s | 107.51 MiB |
| Electrical | 4.79 MB | 1 | 3.78 s | 8.92 s | 0.099 s | 0.003 s | 6.48 s | 108.38 MiB |
| Structural | 6.24 MB | 1 | 3.69 s | 8.21 s | 0.095 s | 0.004 s | 5.78 s | 111.14 MiB |
| Hydraulic | 4.66 MB | 1 | 3.16 s | 7.85 s | 0.086 s | 0.003 s | 6.17 s | 108.13 MiB |

Upload is server reservation-to-receipt elapsed time. Processing is claim-to-complete,
excluding queue wait. Preparation includes rendering/text extraction and synchronous
page storage/database callbacks. Hashing happens during source download (2.73 s and
4.59 s for large packages), so durations overlap and must not be added mechanically.
CPU usage was 41.11 and 105.60 CPU-seconds for the large PDFs. Peak RSS is the Linux
parser child, not total provisioned container memory or a whole-platform peak.

The four-document discipline package totalled 20.03 MB. It was selected as a batch;
Turnstile paused between files, and remaining files resumed in a visible staging
tab. Those human/browser delays are not processing time. This was not a concurrency
load test: one consumer and one container processed queued documents sequentially.

## Workload and lineage

All fixtures are synthetic and non-confidential. A1 architectural room layouts,
electrical symbols/circuits, structural reinforcement grids and hydraulic branches
are combined with vector sheets and A4 specifications/schedules. Raster sheets model
150-dpi grayscale scans with mild scanner grain. Every large image stream is visibly
used; there are no padding streams or hidden attachments. Source generator and
per-page dimension manifests are retained. Sample drawings were rendered and inspected.

Both large files contain real decoding/rendering work, but these are simplified
synthetic construction packages, not independent professional CAD exports. The
tests do not establish reliability for all colour scans, CAD complexity, OCR,
2,000-page files or a full 2 GB tender. Textless scanned sheets receive PNG references;
pages with text currently receive extracted text without an additional image. No
OCR, AI interpretation or M3 analysis was added.

All 104 page indices, expected A1/A4 dimensions and organisation/project/document/
version lineage were verified. The four discipline image keys also matched the
active page lease lineage. Source hashes matched for every file. The large packages
generated 29,678,633 and 76,368,786 derived bytes (46 and 122 objects). The discipline
package generated 6,235,371 bytes across eight derived objects. Sources remain private.

## Fix and regression

The accepted checkpoint rejected these valid scanned sheets with OUTPUT_LIMIT when
redundant RGB PNG data exceeded the 2 MB reference limit. The correction collapses
identical channels to grayscale losslessly. Tests confirm exact pixel identity,
unchanged pixel dimensions and preservation of coloured images. Limits and security
checks were not relaxed. Numeric phase/RSS/CPU telemetry was added with strict
allowlists; tender text, signed URLs, parser strings and secrets are not logged.

- 128 application/database tests, 11 Python parser tests, 24 browser tests passed.
- Lint, type checking, isolated staging build and native Worker SDK transport check passed.
- 11 hosted authentication/CORS/anonymous database checks passed. Two initial test
  harness expectations were corrected: allowed-origin error responses may include
  CORS, and document_pages has no id column. No application security change was needed.
- JS production and pinned Python dependency audits found no known vulnerabilities.
- Pattern scan: 170 Git blobs, 88 source files, 15 build files and 23 artifacts;
  zero unresolved findings. Synthetic test literals were classified separately.
- An 811-event hosted log sample showed no recorded R2 SDK retries or cleanup/request
  failures. This is a bounded observation, not proof that every network packet succeeded.

## Cleanup

After capturing successful results, the 95.6 MB fixture was cancelled through the
authenticated tenant RPC. Only its synthetic deletion timestamp was advanced past
the normal 30-minute grace; no application retention setting changed. Scheduled
cleanup completed at **2026-09-24 21:16:23.781 UTC**, removing all 47 source/derived
objects (125,274,186 bytes), deleting all 27 page rows and scrubbing the filename.
The remaining large package and discipline files retain their ordinary 30/90-day
policies. Both queue and DLQ returned to zero backlog. Full browser refresh restored
the completed tender state. Six versions have six jobs and no duplicate lifecycle metrics.

## Physical device and operational conditions

**Physical iPhone testing is pending**, not replaced by desktop responsive tests.
The founder's staging-only account is provisioned in its own organisation. Requested
steps: create iPhone physical QA, upload two non-confidential PDFs from Files, refresh
during preparation, reopen the tender, confirm Ready and download an original.
Record iPhone model/browser and any failures before closing this condition.

Job failures are discoverable in database states and Worker logs; automatic alert
delivery is not configured. Establish an owner, alert destination and tested
notification/recovery procedure before unattended pilot use. See the separate
operations review for DLQ, backlog, cleanup, container and storage-growth thresholds.
No deliberate container crash or DLQ redrive drill was performed in this stress run.

Cost estimate, including $30 shared platform/database baseline and excluding AI:
approximately $35–50/month at 100 tenders, $50–90 at 1,000, and $230–400 at 10,000,
under the stated 100 MB/100-page/30–90-day assumptions. The largest tier requires
capacity changes: it cannot run on the current single container. Full formulas,
allowances, exclusions and official pricing links are in the separate cost model.

Separate production preflight has been prepared. The current hardcoded staging
guards must be reconciled through a reviewed production configuration change;
production resources, routing, migrations and secrets have not been modified.

