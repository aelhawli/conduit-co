# Milestone 1 provider reliability — staging validation in progress

Scope: existing branch `codex/milestone-1-foundation`, starting checkpoint `bf0fb4f80427775a39195a2bc020f21fb648d877`. Production is NO-GO; no production deployment, domain change, legacy Worker change or Git push is authorised by this work.

## Changes

- Three provider attempts maximum, exponential backoff with 0.5–1.5 jitter, 30 seconds per attempt and 90 seconds overall. Respect Retry-After; return a recoverable error instead of retrying before a delay that cannot fit.
- Retry HTTP 408/429/500/502/503/504 and network/timeouts. Stop on other HTTP errors, redirects, incomplete/invalid output, and recognised daily/zero quota exhaustion. No speculative model fallback.
- Bound provider success/error JSON to 128 KiB. Never log raw provider bodies, PDF contents, keys, contact data or tokens. Structured diagnostics contain a random job ID, attempt number, numeric HTTP status, allowlisted provider code, fixed failure category, retry decision, delay and elapsed time.
- Retries live entirely inside analysis of one existing job. Start/budget charge once; complete/fail once; no lead or unlock during provider retries. Existing unique job-based lead and analytics constraints remain. A failed user submission still consumes the intended abuse-attempt budget, not an unlock or paid credit. A manual resubmission is a new user attempt; the frontend does not automatically resubmit the audit HTTP request.
- Processing UI explains automatic retries; exhaustion restores an enabled button and requires a fresh security check. Old results stay cleared; no failure unlocks an audit.

## Model and diagnosis

Retain staging `gemini-3.8-flash` for the consecutive series. Google documents it as stable, supporting PDFs and structured output. Prior 2.5 requests returned 404; new-project restrictions make reverting unsuitable. 3.5 Flash-Lite is a stable, lower-latency document-parsing candidate, but documentation alone does not establish equivalent risk-detection quality or better availability.

The original four 503 logs established upstream HTTP errors, not their exact cause. New staging diagnostics establish `503 / UNAVAILABLE / capacity`: the provider error text matched an overload/high-demand/capacity category. Original/successful requests used the same small synthetic PDF; current successes also include a four-page drawing set. Thus a consistent malformed payload, size limit, missing model or Worker timeout is not supported by observed evidence. This does not identify Google's internal capacity mechanism or prove a paid tier would fix it.

A pre-series smoke test caught an introduced `redirect: error` incompatibility: Workers rejects that value before network I/O even though it appears in the web type definitions. Reproduced with local workerd, corrected to `manual`, with redirects treated as permanent errors. One smoke job failed safely after three zero-duration network classifications. It is recorded separately, not represented as a Gemini 503 or omitted from development history. The 20-run consecutive series begins after this correction.

## Deployment and interim validation

- Pages: `a99ac510-44be-4e5e-876b-6aeefebc3e3b`, isolated `conduit-co-staging`, branch staging. Live HTML/JS/CSS/logo equal the configured build.
- Worker executable SHA-256: `4ab8f6ecd2efce6d30dc0041856a4988c602bd85a0956bf5fd1ce5085f4b1553`; version `809b661a-aaa7-42de-81d6-86eddeb758bc`, deployment `666f60aa-80ca-4e2e-adcd-d7cbcbb77691`.
- Temporary staging daily cap 50 for testing (baseline 25, eight pre-existing attempts). Restore 25 after series. Native per-IP limits and real Turnstile remain enabled. A browser submission blocked during the security-test cooldown never reached Gemini and is tracked separately from provider trials.
- 104 unit/security/database/build tests pass; 12 mocked desktop/mobile browser tests pass. Lint/typecheck/build pass. Local staging/production dry-runs pass (no deployment). Dependency audits: zero known vulnerabilities.
- 20 hosted HTTP/security checks pass. RLS enabled on all 16 tables, zero direct browser/service-role table grants. Retried analytics event `3f6f9c5e-9472-4625-8258-c231d435bcba` persists exactly once.
- Synthetic fixtures: one-page electrical baseline (2,617 bytes), four-page plumbing (8,662 bytes), twelve-page mixed services (24,087 bytes). These are modest vector drawing sets, not a claim of large/scanned-tender coverage.
- Final 20-run figures, current log scan, final commit and production recommendation remain pending. Do not claim acceptance from interim passes.

References checked 23 September 2026 (Sydney):
- https://ai.google.dev/gemini-api/docs/troubleshooting
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://developers.cloudflare.com/workers/runtime-apis/request/

## Staging model evaluation update

The 3.8 baseline was stopped after **11 consecutive provider-backed audits**, including failures; it is not being represented as a completed 20-audit acceptance pass. Google AI Studio for actual staging project `gen-lang-client-0675067246` showed 3.8 limits of **5 RPM, 250K TPM, 20 RPD**, peak usage 7 RPM and 22 RPD, and an explicit quota warning. Retry calls count toward this budget. Diagnostics distinguish capacity 503s from subsequent 429 RESOURCE_EXHAUSTED daily-quota indicators.

Google AI Studio showed stable **3.5 Flash-Lite** available at **15 RPM, 250K TPM and 500 RPD**. Staging was explicitly switched to `gemini-3.5-flash-lite` for a fresh, designated 20-consecutive-audit evaluation. No billing was enabled, no key/project changed, and production model configuration stayed unchanged. The reason is the documented PDF/document-parsing capability, lower latency, and adequate observed staging quota. This is a lighter model; responsiveness does not establish equal domain reasoning accuracy. Synthetic four/twelve-page outputs recognise seeded connection/fire-stopping uncertainty and schematic limitations; this is limited quality evidence, not an estimator benchmark.

First seven candidate-model audits completed successfully on the first provider call, with seven persisted and unlocked synthetic leads. Audit 8 is prepared and waiting for human Turnstile verification. Final figures remain pending; the real Turnstile widget periodically requires user interaction.
