# Milestone 1 staging reliability — final verification

Verified 23 September 2026 (Sydney), on `codex/milestone-1-foundation`, continuing approved checkpoint `bf0fb4f80427775a39195a2bc020f21fb648d877`. Reliability implementation commit `da978890d1e5d71356b97b7636dbaedbb32db95b`; staging model decision commit `65a581e`.

**Staging reliability acceptance: PASS. Production recommendation: CONDITIONAL GO, subject to the separate production configuration and operational release gates below. Production remains undeployed and requires explicit approval.** No production resource, conduitco.io, legacy Worker, Git history or Milestone 2 feature was changed. No Git push was made.

## Findings and model decision

Reproduced Gemini 3.8 failures returned **503 / UNAVAILABLE** with provider text matching overload/high-demand/capacity indicators. Only that fixed category was logged, never the raw message. Responses arrived before the 30-second timeout. Valid small requests also succeeded, so a consistent malformed request, unavailable model, PDF-size enforcement problem or Worker timeout is not supported by the evidence. Original pre-checkpoint logs contained numeric 503 only; the exact original message cannot be recovered.

Later responses were **429 / RESOURCE_EXHAUSTED** with daily-quota indicators. Google AI Studio for isolated staging project `gen-lang-client-0675067246` confirmed limits of **5 RPM / 250K TPM / 20 RPD** for 3.8, displayed peaks of 7 RPM and 22 RPD, and showed a quota warning. Provider retries count as requests; increasing the application daily cap does not increase Google's quota. Input usage was only 6.36K TPM, below the token limit.

The preserved 3.8 baseline had **11 consecutive audits: 3 successes, 8 final failures**. Two succeeded initially; one recovered on its second call. **1/6 retried audits recovered (16.7%)**. There were 21 provider calls: 3 HTTP 200, 13 capacity 503 and 5 quota 429. The baseline was stopped after confirmed quota exhaustion; it is not presented as a 20-audit acceptance pass.

Staging was explicitly switched to stable **`gemini-3.5-flash-lite`**. Google documents PDF input, structured output and a focus on low-latency document parsing. The actual staging project showed **15 RPM / 250K TPM / 500 RPD**, sufficient for the bounded staging workload. No billing, key or Google project change was made. Production model configuration remains unchanged. This lighter model is a recommended primary candidate for the preliminary audit, based on the hosted results; it still requires expert review on representative real drawings before a broad quality claim. Synthetic four/twelve-page outputs flagged the seeded connection/fire-stopping uncertainty and schematic limitations. This is limited quality evidence, not an estimator benchmark.

## Reliability changes

- Maximum three provider calls per audit; exponential backoff with 0.5–1.5 jitter, 30 seconds per call and 90 seconds overall, including response-body reading. Retry-After is respected; a delay that cannot fit returns a recoverable failure instead of retrying early.
- Retry network/timeouts and HTTP 408/429/500/502/503/504. Stop on other HTTP failures, redirects, known daily/zero quota exhaustion, incomplete generation, malformed JSON or schema-invalid output. No silent model fallback.
- Bound provider success/error bodies to 128 KiB. Diagnostics contain only random job ID, attempt, numeric HTTP status, allowlisted code/category, retry decision/delay and elapsed time. No PDF, contact, token, key, raw provider message or request body is logged.
- Retry inside one existing job. Start/budget charge once; complete or fail once. No lead or unlock during provider retries. Existing unique lead/job and analytics constraints remain. Failed user submissions consume the intended abuse-attempt allowance, not a paid credit or unlock. A manual new submission is a new attempt; the browser never automatically repeats the outer audit request.
- Processing UI explains automatic retries. Exhaustion restores the button and gives a recoverable message with a fresh verification step. Old results remain cleared. Real provider failures and mocked desktop/mobile failures verified this behavior.

A pre-series smoke test caught an introduced `redirect: error` incompatibility in Workers, before network I/O. Local workerd reproduced it; it was corrected to `manual`, while rejecting redirect responses. That one job failed safely without a lead. It is separate from the 3.8 provider baseline and the final 20-run series. Another browser submission hit the security-test rate-limit cooldown before creating a job; it is also excluded from provider-trial counts. Neither is concealed as a Gemini failure or a successful trial.

## Twenty consecutive final-model hosted audits

Actual browser path for every run: PDF selection, real Turnstile, Gemini, preview, lead gate, persisted synthetic lead, unlocked audit. Runs 1–10 used desktop 1280x900; runs 11–20 used mobile 390x844. No mocks, test Turnstile keys, auth bypass or direct provider calls were used for this series. Human verification pauses and rate-limit pacing are excluded from processing times.

| Metric | Result |
| --- | --- |
| Successful audits | 20/20 |
| First-provider-call successes | 20/20 |
| Recovered through retry | 0; none needed |
| Retry recovery rate | Not applicable (0/0); baseline demonstrated 1/6 recovery |
| Final failure rate | 0/20 (0%) |
| Provider processing median / worst | 1.923 s / 3.412 s |
| API processing median / worst | 2.3535 s / 3.721 s |
| Provider / API HTTP status | 200 for all 20 |
| Jobs / consented leads / unlocks | 20 / 20 / 20 |
| Duplicate lead/job groups / job-event groups | 0 / 0 |

API time is Cloudflare invocation wall time, including verification/database/provider work; it excludes browser-to-edge upload and human form-entry time. The provider figures include internal backoff if any. All records reconcile by job ID in `STAGING-RELIABILITY-RESULTS.json`.

Three valid synthetic vector PDFs were rotated: one-page electrical (2,617 bytes), four-page plumbing (8,662 bytes), twelve-page mixed services (24,087 bytes). Twenty short synthetic runs are not a production SLA, a large/scanned-PDF benchmark or proof of future provider availability.

| Run | Viewport | PDF pages | Provider ms | API ms | Attempts | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Desktop | 1 | 1927 | 2585 | 1 | Saved and unlocked |
| 2 | Desktop | 4 | 2262 | 2723 | 1 | Saved and unlocked |
| 3 | Desktop | 12 | 2210 | 2507 | 1 | Saved and unlocked |
| 4 | Desktop | 1 | 1783 | 2353 | 1 | Saved and unlocked |
| 5 | Desktop | 4 | 1854 | 2426 | 1 | Saved and unlocked |
| 6 | Desktop | 12 | 1841 | 2121 | 1 | Saved and unlocked |
| 7 | Desktop | 1 | 2053 | 2338 | 1 | Saved and unlocked |
| 8 | Desktop | 4 | 1892 | 2597 | 1 | Saved and unlocked |
| 9 | Desktop | 12 | 2046 | 2420 | 1 | Saved and unlocked |
| 10 | Desktop | 1 | 1735 | 2064 | 1 | Saved and unlocked |
| 11 | Mobile | 4 | 1965 | 2264 | 1 | Saved and unlocked |
| 12 | Mobile | 12 | 1919 | 2233 | 1 | Saved and unlocked |
| 13 | Mobile | 1 | 1866 | 2173 | 1 | Saved and unlocked |
| 14 | Mobile | 4 | 2147 | 2451 | 1 | Saved and unlocked |
| 15 | Mobile | 12 | 2033 | 2583 | 1 | Saved and unlocked |
| 16 | Mobile | 1 | 1670 | 1985 | 1 | Saved and unlocked |
| 17 | Mobile | 4 | 1679 | 1980 | 1 | Saved and unlocked |
| 18 | Mobile | 12 | 1995 | 2354 | 1 | Saved and unlocked |
| 19 | Mobile | 1 | 3412 | 3721 | 1 | Saved and unlocked |
| 20 | Mobile | 4 | 1774 | 2093 | 1 | Saved and unlocked |

## Database and security verification

Exactly 20 jobs, 20 consented/unlocked leads and 20 upload-start events. Each job has exactly one audit_started, upload_completed, audit_completed, lead_form_displayed, lead_captured and audit_unlocked event (120 job-linked events total). Zero duplicate lead/job groups or job-event groups. All failed jobs across the staging history have zero leads. Original PDF document rows remain zero.

- **104 automated unit/security/database/build tests pass; 12 mocked desktop/mobile browser tests pass.** Lint, strict types, configured staging build, regenerated Worker types and both local environment dry-runs pass. Dry-runs do not deploy production.
- **20 final hosted HTTP/security checks pass**, covering invalid PDF, decoded 7 MiB enforcement, real invalid-Turnstile rejection, rate limiting, exact CORS, strict lead/event validation, unknown audit capability denial and anonymous database table/RPC denial. Dedup probe event `f6754bbe-ba82-47d0-816b-c6a69ef159f8` persists exactly once.
- All 16 tables retain RLS; zero direct table grants for PUBLIC, anon, authenticated or service_role. Controlled server RPC architecture is unchanged.
- Desktop document width 1265 within 1280; mobile 375 within 390. Risk rendering contains no script/image/iframe/link nodes. Automated browser tests also exercise hostile AI HTML as inert text and failure recovery without stale unlocks.
- Both dependency audits report zero known vulnerabilities. Source/build/archive/reachable-history credential scans have zero unresolved findings. Browser console scans and the 564 returned Worker log events in the bounded 24-hour query detected no credential or synthetic-PDF content patterns. These are bounded pattern checks, not proof about arbitrary disguised credentials or all possible logs. The earlier credential incident remains recorded in historical staging documentation; this report does not erase it.

## Infrastructure and release conditions

- Frontend: https://conduit-co-staging.pages.dev, Pages deployment `a99ac510-44be-4e5e-876b-6aeefebc3e3b`, branch staging, no Git integration or production domain. Live HTML/JS/CSS/logo match the staging build.
- Worker: https://conduit-api-staging.letstalk-531.workers.dev, version `2f3949c2-d23e-4016-a235-9ae873f9c19d`, deployment `cd0caf39-8595-484f-8a79-f0f64284f14e`, 100%. Executable SHA-256 `4ab8f6ecd2efce6d30dc0041856a4988c602bd85a0956bf5fd1ce5085f4b1553` matches the local build.
- Supabase remains staging project `kvujhszkrblaovnksafx`. All four Worker secrets remain encrypted secret_text; CORS permits only the staging Pages origin. Real staging-only Turnstile and native rate limits remain enabled; previews remain disabled.
- The temporary staging cap of 50 was **restored to 25**. Recorded usage is 40 for 22 September UTC: eight prior attempts, one smoke job, eleven baseline audits and twenty final-model audits. More valid audits are therefore intentionally blocked until **23 September 00:00 UTC / 10:00 am Sydney**. Usage records were not reset or deleted.
- Production read-only baselines remain unchanged: Pages `d26b3143-6454-4618-9a00-7b3df55d91ea`; legacy Worker `a6117d3b-42c9-43b7-811c-0978e988815e`. No production deployment, secret transfer, DNS change or legacy retirement occurred.

The Gemini/repeat-upload staging blocker is resolved for this acceptance sample. Production remains conditional on approved separate production model/credential/quota configuration, region/retention/provider-data-use/backups decisions, data-preserving rollback rehearsal, automatic-deployment controls and the approved legacy cutover plan already listed in RELEASE-READINESS.md. Review the lighter model on real domain examples. No billing or credential manual action is required to keep the tested staging configuration. **Stop before production deployment and obtain explicit approval.**

References checked 23 September 2026 (Sydney):
- https://ai.google.dev/gemini-api/docs/troubleshooting
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://developers.cloudflare.com/workers/runtime-apis/request/
