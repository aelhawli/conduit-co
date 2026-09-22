import { auditResponseSchema, leadRequestSchema, leadResponseSchema, MAX_PDF_BYTES } from '../shared/contracts';
import { attributionFrom, sendEvent, sessionId } from './analytics';
import { renderRisks } from './render';
import type { z } from 'zod';

declare const __API_BASE_URL__: string;
declare const __TURNSTILE_SITE_KEY__: string;
declare global {
  interface Window {
    turnstile?: { render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string; reset: (id: string) => void };
    conduitTurnstileReady?: () => void;
  }
}
function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id); if (!found) throw new Error('Missing interface element'); return found as T;
}
const input = element<HTMLInputElement>('pdf-input');
const button = element<HTMLButtonElement>('scan-btn');
const unlock = element<HTMLButtonElement>('unlock-btn');
const status = element('audit-status');
const results = element('results');
const gate = element('lead-gate');
const risks = element('risk-list');
const leadForm = element<HTMLFormElement>('lead-form');
const attribution = attributionFrom(location.href, document.referrer);
let selectedFile: File | undefined;
let current: z.infer<typeof auditResponseSchema> | undefined;
let generation = 0;
let pending: AbortController | undefined;
let verification = '';
let widgetId: string | undefined;

function error(id: string, message = ''): void { const el = element(id); el.textContent = message; el.hidden = !message; }
function resetResults(): void {
  const wasPending = Boolean(pending);
  generation++; pending?.abort(); pending = undefined; current = undefined;
  if (wasPending) resetVerification();
  results.hidden = true; gate.hidden = false; risks.hidden = true; risks.replaceChildren();
  element('audit-summary').textContent = ''; error('audit-error'); error('lead-error'); status.textContent = '';
  button.disabled = false; unlock.disabled = false; button.textContent = 'Run Free Tender Audit →'; unlock.textContent = 'Unlock Full Audit →';
}
function select(file?: File): void {
  resetResults(); selectedFile = file;
  element('file-label').textContent = file ? `Selected: ${file.name}` : 'Choose a PDF or drag and drop your plan set';
}
input.addEventListener('change', () => select(input.files?.[0]));
const drop = element('drop-zone');
drop.addEventListener('dragover', e => { e.preventDefault(); });
drop.addEventListener('drop', e => {
  e.preventDefault(); input.value = '';
  if (e.dataTransfer?.files.length !== 1) { select(); error('audit-error', 'Please select one PDF at a time.'); return; }
  select(e.dataTransfer.files[0]);
});

async function request(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetch(`${__API_BASE_URL__}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }); }
  catch { throw new Error('The connection was interrupted or timed out. Please try again.'); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('The service returned an unreadable response. Please try again.'); }
  if (!response.ok) {
    // Do not echo arbitrary upstream/proxy error text into the UI.
    const code = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'object' && data.error !== null && 'code' in data.error ? data.error.code : '';
    const messages: Record<string, string> = {
      RATE_LIMITED: 'Too many requests. Please wait a minute and try again.', AUDIT_CAPACITY: 'The free audit service has reached its daily capacity. Please try again tomorrow.',
      VERIFICATION_FAILED: 'Please complete the security check again.', INVALID_PDF: 'Please select a complete, valid PDF.',
      AUDIT_UNAVAILABLE: 'This audit has expired. Please run a new audit.', INVALID_LEAD: 'Please check all contact details and consent.',
      AUDIT_TIMEOUT: 'The audit took too long. Please try a smaller drawing set.', REQUEST_TOO_LARGE: 'Please select a PDF up to 7 MiB.'
    };
    throw new Error(typeof code === 'string' && messages[code] || 'We could not complete that request. Please try again shortly.');
  }
  return data;
}
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.readAsDataURL(file);
  });
}
function resetVerification(): void { verification = ''; if (widgetId !== undefined) window.turnstile?.reset(widgetId); }
async function runAudit(): Promise<void> {
  if (pending) return;
  resetResults();
  const version = generation;
  const file = selectedFile;
  if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size === 0 || file.size > MAX_PDF_BYTES) { error('audit-error', 'Please select a PDF up to 7 MiB.'); return; }
  if (!verification) { error('audit-error', 'Please complete the security check first.'); return; }
  const token = verification;
  button.disabled = true; button.textContent = 'Analysing your drawing set…'; status.textContent = 'Uploading and analysing. Please keep this page open.';
  pending = new AbortController();
  const signal = AbortSignal.any([pending.signal, AbortSignal.timeout(120000)]);
  void sendEvent(__API_BASE_URL__, { eventId: crypto.randomUUID(), sessionId, name: 'tender_upload_started' });
  try {
    const pdfBase64 = await base64(file);
    if (version !== generation) return;
    const data = auditResponseSchema.parse(await request('/api/audits', { pdfBase64, sessionId, turnstileToken: token }, signal));
    if (version !== generation) return;
    current = data; element('audit-summary').textContent = data.summary; results.hidden = false; status.textContent = 'Audit complete. Enter your details to reveal the risks.';
    void sendEvent(__API_BASE_URL__, { eventId: crypto.randomUUID(), sessionId, name: 'lead_form_displayed', jobId: data.jobId, auditToken: data.auditToken });
  } catch (err) { if (version === generation) { status.textContent = ''; error('audit-error', err instanceof Error && err.name !== 'ZodError' ? err.message : 'The audit response could not be read. Please try again.'); } }
  finally { if (version === generation) { pending = undefined; button.disabled = false; button.textContent = 'Run Free Tender Audit →'; resetVerification(); } }
}

async function captureLead(): Promise<void> {
  if (!current || unlock.disabled) return;
  const version = generation; const audit = current;
  const body = leadRequestSchema.safeParse({
    jobId: audit.jobId, auditToken: audit.auditToken,
    name: element<HTMLInputElement>('lead-name').value, company: element<HTMLInputElement>('lead-company').value,
    email: element<HTMLInputElement>('lead-email').value, mobile: element<HTMLInputElement>('lead-phone').value,
    trade: element<HTMLSelectElement>('lead-trade').value, attribution,
    contactConsent: element<HTMLInputElement>('lead-consent').checked, website: element<HTMLInputElement>('lead-website').value
  });
  if (!body.success) { error('lead-error', 'Please check your contact details, mobile number and consent.'); return; }
  error('lead-error'); unlock.disabled = true; unlock.textContent = 'Saving your details…';
  try {
    const result = leadResponseSchema.parse(await request('/api/leads', body.data, AbortSignal.timeout(20000)));
    if (version !== generation) return;
    renderRisks(risks, result.audit); gate.hidden = true; risks.hidden = false; leadForm.reset();
    status.textContent = 'Your audit is unlocked.';
    void sendEvent(__API_BASE_URL__, { eventId: crypto.randomUUID(), sessionId, name: 'audit_unlocked', jobId: audit.jobId, auditToken: audit.auditToken });
  } catch (err) { if (version === generation) error('lead-error', err instanceof Error && err.name !== 'ZodError' ? err.message : 'We could not unlock the audit. Please try again.'); }
  finally { if (version === generation) { unlock.disabled = false; unlock.textContent = 'Unlock Full Audit →'; } }
}
element<HTMLFormElement>('audit-form').addEventListener('submit', e => { e.preventDefault(); void runAudit(); });
leadForm.addEventListener('submit', e => { e.preventDefault(); void captureLead(); });
void sendEvent(__API_BASE_URL__, { eventId: crypto.randomUUID(), sessionId, name: 'landing_page_visit' });

window.conduitTurnstileReady = () => {
  widgetId = window.turnstile?.render(element('turnstile-widget'), {
    sitekey: __TURNSTILE_SITE_KEY__, action: 'audit', callback: token => { verification = token; },
    'expired-callback': () => { verification = ''; },
    'error-callback': () => { verification = ''; error('audit-error', 'The security check could not load. Please refresh and try again.'); }
  });
};
if (__TURNSTILE_SITE_KEY__) {
  const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=conduitTurnstileReady&render=explicit'; script.async = true;
  script.onerror = () => error('audit-error', 'The security check could not load. Please refresh and try again.'); document.head.appendChild(script);
} else { button.disabled = true; error('audit-error', 'This environment is awaiting its security-check configuration.'); }
