# Funnel analytics

First-party events live in `public.product_events`. No third-party analytics account or SDK is needed for M1.

| Event | Authority | Meaning |
| --- | --- | --- |
| `landing_page_visit` | Client | Page script initialised; once per random page-session |
| `tender_upload_started` | Client | Valid local file/security token, user initiated an attempt |
| `upload_completed` | Server | Body/PDF/Turnstile accepted and job admitted within budget |
| `audit_started` | Server | Job created before Gemini request |
| `audit_completed` | Server | Valid AI result saved successfully |
| `lead_form_displayed` | Client | Summary and contact gate rendered |
| `lead_captured` | Server | Contact transaction committed |
| `audit_unlocked` | Client | Saved audit risks rendered after lead capture |

`upload_completed` measures accepted uploads, not merely bytes transmitted. Failed validation/Turnstile/budget admission does not count as an accepted upload. Each successful audit has a server-generated job ID. Upload starts before a job ID exists are associated with the page-session ID; separate attempts have distinct event IDs.

Deduplication: event UUID handles retry; one event of each type per job; landing visit once per page-session. Repeat upload attempts are counted individually. Client events retry once without blocking the funnel. Session identity is not stored in a cookie/local storage and is regenerated on reload. Counts describe page sessions, not unique people.

The API rejects arbitrary event properties and rejects client attempts to manufacture server milestone names. Job-linked client events require the job token and matching session. Anonymous visits/starts can still be spoofed within the edge rate limit; these are observational product metrics, not billing/accounting records.

No document bytes, extracted text, findings, filenames, contact fields, full referral URLs, URL query strings or IP addresses are stored in analytics. Audit tokens are used solely for endpoint authorisation and are not persisted in the event rows. Lead attribution is stored separately with contact data: only safe campaign identifiers and referral hostname are accepted. Campaign naming must never encode personal or tender information.

## Read-only operator queries

Run through the authorised database console, not the public browser API:

```sql
select date_trunc('day', occurred_at) as day, name, count(*)
from public.product_events
group by 1, 2 order by 1 desc, 2;

select count(*) filter (where status = 'completed') as completed_audits,
       count(*) filter (where status = 'failed') as failed_audits,
       count(*) filter (where status = 'running') as running_or_abandoned
from public.analysis_jobs where kind = 'free_audit';

select conversion_state, trade, count(*)
from public.leads group by conversion_state, trade;
```

Add cohort/date filters when calculating conversion; compare jobs within the same cohort and allow for delayed lead capture. Client event loss can cause apparent funnel gaps even when the server saved a lead successfully.
