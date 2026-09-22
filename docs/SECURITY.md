# Milestone 1 security review

## Implemented controls

- Gemini and database credentials are server-only secret bindings; no secret value is committed. Gemini key uses a header, not a query string.
- Exact-origin production CORS; no wildcard origins or wildcard headers. Unapproved or missing origins are rejected on funnel endpoints. CORS is not considered authentication.
- Turnstile server validation checks success, expected hostname and `audit` action before spending an AI call. No production bypass flag.
- Native per-IP rate limits use salted hashes; missing production connecting-IP metadata or limiter failures fail closed. An atomic PostgreSQL daily attempt budget caps distributed AI requests.
- Stream-bounded JSON reads, strict schemas, base64/decoded-length validation, PDF header/end markers, 7 MiB server limit, bounded provider output and request timeouts.
- Stable safe errors and structured logs containing only request/job IDs and safe codes; no raw provider or database errors.
- Random job capabilities with 24-hour expiry, hashed at rest. Full risks stay server-side until the lead transaction succeeds.
- Strict lead lengths, email/mobile/trade validation, consent record, honeypot field, bounded attribution and duplicate-safe persistence.
- Untrusted AI strings use text nodes. No application `innerHTML`, inline handlers or runtime CSS CDN.
- Compiled frontend includes a CSP, no-sniff, referrer and permissions headers. Only `dist/web` is publishable.
- All schema tables deny direct browser and service-role access. Only the five explicitly granted service-role RPCs serve the funnel.
- Analytics accepts only defined events and no arbitrary properties; transactional server events cannot be submitted through the client endpoint.
- Separate staging/production configs and secrets, pinned packages/lockfile and action commits, checks-only CI.

## Deliberate limits and release checks

- PDF marker validation is not antivirus or a full PDF parser. Large-file storage/scanning pipelines are outside M1.
- AI-generated scope advice remains preliminary. The schema validates structure, not truth. There is no verified takeoff or accuracy claim.
- A job capability grants access to that one audit; protect it like a temporary credential. There are no user accounts in M1.
- Cloudflare's native rate limiter is local/eventually consistent; the daily database budget provides a global cap. Shared contractor/NAT networks may hit per-IP limits and limits may need adjustment from actual traffic.
- Public visit/start analytics can be fabricated within rate limits. Analytics is not a billing authority.
- A timeout/disconnect may leave a running record; no background processing or automatic replay is introduced. New audit attempts consume new budget.
- Contact/result retention, provider data handling, backup retention and deletion operations must be approved before launch. Token expiry does not delete data.
- The previous live Worker is unchanged during review. Its plaintext key and open endpoint remain legacy risks until the approved cutover/retirement steps are completed.
- No production penetration test, paid model call, real Supabase deployment or cloud secret change was performed.

## Verification

Tests cover oversized bodies and PDF boundaries, hostile origins, failed challenge validation, limiter failures, global budget, provider errors, gated result delivery, SQL grants/RLS, lead retries/expiry, tenant foreign keys, event privacy/deduplication, HTML injection, desktop/mobile save failures and stale UI state. Real staging validation remains mandatory before production approval.
