import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type WorkerEnv } from '../src/worker';
import type { Database } from '../src/worker/db';
import { SupabaseDatabase } from '../src/worker/db';
import { validatePdf, hash } from '../src/worker/security';
import { readJson } from '../src/worker/http';
import { MAX_PDF_BYTES } from '../src/shared/contracts';

const origin = 'https://conduitco.io';
const sid = '11111111-1111-4111-8111-111111111111';
const job = '22222222-2222-4222-8222-222222222222';
const pdf = btoa('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const audit = { summary: 'A preliminary scope summary.', topRisks: [{ title: '<img src=x onerror=alert(1)>', description: 'Check the legend.' }] };
const lead = { jobId: job, auditToken: 'a'.repeat(64), name: 'Test Person', company: 'Test Electrical', email: 'test@example.com', mobile: '0400 000 000', trade: 'Electrical', attribution: {}, contactConsent: true, website: '' };
let env: WorkerEnv;
let db: Database;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
function request(path: string, body: unknown, requestOrigin: string | null = origin) {
  const headers: Record<string,string> = { 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' };
  if (requestOrigin) headers.Origin = requestOrigin;
  return new Request(`https://api.example.com${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
const auditBody = () => ({ pdfBase64: pdf, sessionId: sid, turnstileToken: 'verified-test-token' });
beforeEach(() => {
  env = { ENVIRONMENT: 'production', ALLOWED_ORIGINS: origin, GEMINI_MODEL: 'gemini-2.5-flash', DAILY_AUDIT_LIMIT: '250', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake', GEMINI_API_KEY: 'private-key', TURNSTILE_SECRET_KEY: 'turnstile-secret', RATE_LIMIT_SALT: 's'.repeat(32), AUDIT_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) }, FUNNEL_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) } };
  db = { startJob: vi.fn().mockResolvedValue(undefined), completeJob: vi.fn().mockResolvedValue(undefined), failJob: vi.fn().mockResolvedValue(undefined), captureLead: vi.fn().mockResolvedValue(audit), recordEvent: vi.fn().mockResolvedValue(undefined) };
  fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
    if (String(input).includes('siteverify')) return Response.json({ success: true, hostname: 'conduitco.io', action: 'audit' });
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(audit) }] } }] });
  });
});
const run = (r: Request) => handleRequest(r, env, { database: db, fetcher });

describe('Worker boundary and abuse protection', () => {
  it('ignores user-controlled forwarding headers when constructing rate keys', async () => {
    for (const value of ['198.51.100.1', '203.0.113.10']) {
      const r = request('/api/audits', auditBody());
      r.headers.set('X-Forwarded-For', value); r.headers.set('X-Real-IP', value); r.headers.set('True-Client-IP', value);
      expect((await run(r)).status).toBe(200);
    }
    const calls = vi.mocked(env.AUDIT_RATE_LIMITER.limit).mock.calls;
    expect(calls[0]).toEqual(calls[1]);
  });
  it('rejects Worker subrequests before rate limiting or provider calls', async () => {
    const r = request('/api/audits', auditBody()); r.headers.set('CF-Worker', 'proxy.example');
    expect((await run(r)).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
    expect(env.AUDIT_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });
  it.each(['https://evil.example','https://conduitco.io.evil.example',null])('rejects origin %s before outbound work', async o => {
    expect((await run(request('/api/audits', auditBody(), o))).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns explicit CORS only for approved origins', async () => {
    const response = await run(request('/api/audits', auditBody()));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin); expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('accepts only POST preflight with Content-Type', async () => {
    const r = await run(new Request('https://api.example.com/api/leads', { method:'OPTIONS', headers:{ Origin:origin, 'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'content-type' } }));
    expect(r.status).toBe(204); expect(r.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect((await run(new Request('https://api.example.com/api/leads', { method:'OPTIONS', headers:{ Origin:origin, 'Access-Control-Request-Method':'DELETE' } }))).status).toBe(405);
  });
  it('rate limits before reading or calling Gemini', async () => {
    vi.mocked(env.AUDIT_RATE_LIMITER.limit).mockResolvedValue({ success: false });
    const r = await run(request('/api/audits', auditBody())); expect(r.status).toBe(429); expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(env.AUDIT_RATE_LIMITER.limit).mock.calls)).not.toContain('192.0.2.1');
  });
  it('fails closed when the limiter is unavailable', async () => {
    vi.mocked(env.AUDIT_RATE_LIMITER.limit).mockRejectedValue(new Error('private provider details'));
    const r = await run(request('/api/audits', auditBody())); expect(r.status).toBe(503); expect(await r.text()).not.toContain('private provider');
  });
  it('requires a trusted connecting IP in production', async () => {
    const r = request('/api/audits', auditBody()); r.headers.delete('CF-Connecting-IP'); expect((await run(r)).status).toBe(503);
  });
  it.each([{ success:false }, { success:true,hostname:'evil.example',action:'audit' }, { success:true,hostname:'conduitco.io',action:'login' }])('rejects invalid Turnstile validation %#', async result => {
    fetcher.mockResolvedValue(Response.json(result)); expect((await run(request('/api/audits',auditBody()))).status).toBe(403); expect(db.startJob).not.toHaveBeenCalled();
  });
  it('does not call AI if the database budget is exhausted', async () => {
    const { AppError } = await import('../src/worker/errors'); vi.mocked(db.startJob).mockRejectedValue(new AppError(429,'AUDIT_CAPACITY','Capacity reached'));
    expect((await run(request('/api/audits',auditBody()))).status).toBe(429); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects unexpected fields and malformed PDFs', async () => {
    expect((await run(request('/api/audits',{...auditBody(), extra:'secret'}))).status).toBe(400);
    expect((await run(request('/api/audits',{...auditBody(),pdfBase64:btoa('not a pdf')}))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds actual bytes without trusting Content-Length', async () => {
    const r = new Request('https://test.invalid', { method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(101) });
    await expect(readJson(r,100)).rejects.toMatchObject({status:413});
  });
  it('rejects malformed JSON and wrong content type', async () => {
    await expect(readJson(new Request('https://test.invalid',{method:'POST',body:'{}'}),100)).rejects.toMatchObject({status:415});
    await expect(readJson(new Request('https://test.invalid',{method:'POST',headers:{'content-type':'application/json'},body:'{'}),100)).rejects.toMatchObject({status:400});
  });
  it('accepts the exact PDF size boundary and rejects one byte over it', () => {
    const valid = '%PDF-1.4\n' + ' '.repeat(MAX_PDF_BYTES - 15) + '\n%%EOF';
    expect(Buffer.byteLength(valid)).toBe(MAX_PDF_BYTES);
    expect(() => validatePdf(btoa(valid))).not.toThrow();
    expect(() => validatePdf(btoa(valid + ' '))).toThrow();
  });
});

describe('Audit and lead persistence', () => {
  it('persists a completed audit but returns only the summary and capability', async () => {
    const r = await run(request('/api/audits',auditBody())); const data = await r.json();
    expect(r.status).toBe(200); expect(data.summary).toBe(audit.summary); expect(data.topRisks).toBeUndefined(); expect(data.audit).toBeUndefined();
    expect(data.auditToken).toMatch(/^[a-f0-9]{64}$/); expect(db.completeJob).toHaveBeenCalledWith(data.jobId,audit);
    expect(db.startJob).toHaveBeenCalledWith(data.jobId,await hash(data.auditToken),sid);
    const [url, options] = fetcher.mock.calls[1]!;
    expect(String(url)).not.toContain('private-key'); expect(new Headers(options?.headers).get('x-goog-api-key')).toBe('private-key');
  });
  it('saves a lead before returning risks', async () => {
    const r = await run(request('/api/leads',lead)); expect(r.status).toBe(200); expect((await r.json()).audit).toEqual(audit); expect(db.captureLead).toHaveBeenCalledWith(lead,await hash(lead.auditToken));
  });
  it.each(['organisation_id', 'conversion_state', 'created_at', 'id'])('rejects lead mass assignment of %s', async field => {
    expect((await run(request('/api/leads', { ...lead, [field]: 'attacker-controlled' }))).status).toBe(400);
    expect(db.captureLead).not.toHaveBeenCalled();
  });
  it.each(['GET', 'PATCH', 'DELETE', 'PUT'])('does not expose a lead %s operation', async method => {
    expect((await run(new Request('https://api.example.com/api/leads', { method, headers: { Origin: origin } }))).status).toBe(405);
    expect(db.captureLead).not.toHaveBeenCalled();
  });
  it.each([{ company:'' }, { email:'bad' }, { mobile:'abcdefghi' }, { contactConsent:false }, { website:'spam' }])('rejects invalid lead fields %#', async fields => {
    expect((await run(request('/api/leads',{...lead,...fields}))).status).toBe(400); expect(db.captureLead).not.toHaveBeenCalled();
  });
  it('does not unlock on a database error', async () => {
    vi.mocked(db.captureLead).mockRejectedValue(new Error('database credentials must not leak'));
    const r = await run(request('/api/leads',lead)); expect(r.status).toBe(503); expect(await r.text()).not.toContain('credentials');
  });
  it.each([{ candidates:[] }, { error:{message:'provider private detail'} }, { candidates:[{content:{parts:[{text:'not JSON'}]}}] }, { candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(audit)}]}}] }])('handles malformed provider response %# safely', async payload => {
    fetcher.mockImplementation(async input => String(input).includes('siteverify') ? Response.json({success:true,hostname:'conduitco.io',action:'audit'}) : Response.json(payload));
    const r = await run(request('/api/audits',auditBody())); expect(r.status).toBe(502); expect(await r.text()).not.toContain('private detail'); expect(db.failJob).toHaveBeenCalled();
  });
  it('records no successful completion if persistence fails', async () => {
    vi.mocked(db.completeJob).mockRejectedValue(new Error('database offline')); const r = await run(request('/api/audits',auditBody())); expect(r.status).toBe(503); expect(db.failJob).toHaveBeenCalled();
  });
  it('does not log private provider bodies for permanent HTTP errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetcher.mockImplementation(async input => String(input).includes('siteverify') ? Response.json({success:true,hostname:'conduitco.io',action:'audit'}) : new Response('private provider body containing credentials', {status:403}));
      const r = await run(request('/api/audits',auditBody()));
      expect(r.status).toBe(502);
      expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toContainEqual(expect.objectContaining({event:'gemini_attempt',status:403,willRetry:false}));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('credentials');
      expect(await r.text()).not.toContain('private provider');
    } finally { warn.mockRestore(); }
  });
  it('records allowlisted client events without arbitrary properties', async () => {
    const body = {eventId:job, sessionId:sid,name:'landing_page_visit'};
    expect((await run(request('/api/events',body))).status).toBe(200);
    expect((await run(request('/api/events',{...body,document:'private drawing'}))).status).toBe(400);
    expect((await run(request('/api/events',{...body,name:'lead_captured'}))).status).toBe(400);
  });
  it('the database adapter never exposes backend error bodies', async () => {
    const adapter = new SupabaseDatabase(env,vi.fn().mockResolvedValue(new Response('secret db contents',{status:500})));
    await expect(adapter.startJob(job,'a'.repeat(64),sid)).rejects.toMatchObject({code:'SERVICE_UNAVAILABLE'});
  });
  it('calls the platform fetch without a database instance receiver', async () => {
    const nativeLikeFetch: typeof fetch = async function (this: unknown) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return Response.json(true);
    };
    const adapter = new SupabaseDatabase(env, nativeLikeFetch);
    await expect(adapter.recordEvent({ eventId: job, sessionId: sid, name: 'landing_page_visit' })).resolves.toBeUndefined();
  });
});
