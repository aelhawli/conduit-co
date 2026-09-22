import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { analysePdf } from '../src/worker/gemini';
import { handleRequest, type WorkerEnv } from '../src/worker';
import type { Database } from '../src/worker/db';
const audit = { summary: 'Synthetic scope summary.', topRisks: [] };
const success = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(audit) }] } }] });
const env = { GEMINI_API_KEY: 'private-key', GEMINI_MODEL: 'gemini-3.8-flash' };
const job = '22222222-2222-4222-8222-222222222222';
const pdf = btoa('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function settle<T>(promise: Promise<T>): Promise<T> {
  // Attach rejection handling before advancing time to avoid unhandled rejections.
  const result = promise.then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  const r = await result;
  if ('error' in r) throw r.error;
  return r.value;
}
it.each([408, 429, 500, 502, 503, 504])('recovers transient HTTP %s inside bounded backoff', async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { status: 'UNAVAILABLE', message: 'private-key PDF contents high demand' } }, { status })).mockResolvedValueOnce(success());
  expect(await settle(analysePdf(pdf, env, fetcher, job))).toEqual(audit);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"recovered":true'));
  const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"delayMs":1000')); expect(logs).not.toContain('private-key'); expect(logs).not.toContain('PDF contents');
  expect(fetcher.mock.calls[0]![1]!.redirect).toBe('manual');
  expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body);
});
it.each([301, 302, 307, 308, 400, 401, 402, 403, 404, 413, 501, 505])('does not retry permanent HTTP %s', async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { status: 'INVALID_ARGUMENT' } }, { status }));
  await expect(settle(analysePdf(pdf, env, fetcher, job))).rejects.toMatchObject({ code: 'AUDIT_FAILED' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('stops after three transient failures with no private details', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ error: { status: 'UNAVAILABLE', message: 'model capacity exhausted private details' } }, { status: 503 }));
  await expect(settle(analysePdf(pdf, env, fetcher, job))).rejects.toMatchObject({ status: 503, code: 'AUDIT_TEMPORARILY_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"kind":"capacity"'));
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private details');
});
it('respects Retry-After and does not retry early if outside deadline', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
  await expect(settle(analysePdf(pdf, env, fetcher, job))).rejects.toMatchObject({ code: 'AUDIT_TEMPORARILY_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('honours a Retry-After HTTP date within the budget', async () => {
  const start = Date.now();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({}, { status: 503, headers: { 'Retry-After': new Date(start + 10000).toUTCString() } })).mockResolvedValueOnce(success());
  await settle(analysePdf(pdf, env, fetcher, job));
  expect(Date.now() - start).toBeGreaterThanOrEqual(9000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not burn retries on a known daily quota', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }, { status: 429 }));
  await expect(settle(analysePdf(pdf, env, fetcher, job))).rejects.toMatchObject({ code: 'AUDIT_TEMPORARILY_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('recovers network failure', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('private network detail')).mockResolvedValueOnce(success());
  expect(await settle(analysePdf(pdf, env, fetcher, job))).toEqual(audit);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('bounds unresponsive fetches to 90 seconds and aborts all attempts', async () => {
  const start = Date.now();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  await expect(settle(analysePdf(pdf, env, fetcher, job))).rejects.toMatchObject({ code: 'AUDIT_TIMEOUT' });
  expect(Date.now() - start).toBe(90000); expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
});
it('bounds a stalled response body, not just headers', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new ReadableStream({ start() {} })));
  await expect(settle(analysePdf(pdf, env, fetcher, job))).rejects.toMatchObject({ code: 'AUDIT_TIMEOUT' });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it.each([{ candidates: [] }, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(audit) }] } }] }])('does not retry invalid or incomplete output %#', async payload => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
  await expect(settle(analysePdf(pdf, env, fetcher, job))).rejects.toMatchObject({ code: 'AUDIT_FAILED' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([true, false])('provider retries preserve one job and safe final state (recovery=%s)', async recover => {
  const db: Database = { startJob: vi.fn(), completeJob: vi.fn(), failJob: vi.fn(), captureLead: vi.fn(), recordEvent: vi.fn() };
  let calls = 0;
  let entered!: () => void;
  const providerStarted = new Promise<void>(resolve => { entered = resolve; });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
    if (String(input).includes('siteverify')) return Response.json({ success: true, hostname: 'staging.example', action: 'audit' });
    entered();
    return (++calls < 3 || !recover) ? Response.json({}, { status: 503 }) : success();
  });
  const fullEnv: WorkerEnv = { ...env, SUPABASE_URL: 'https://staging.example', SUPABASE_SERVICE_ROLE_KEY: 'fake', TURNSTILE_SECRET_KEY: 'fake', DAILY_AUDIT_LIMIT: '25', FUNNEL_RATE_LIMITER: { limit: async () => ({ success: true }) }, ENVIRONMENT: 'staging', ALLOWED_ORIGINS: 'https://staging.example', RATE_LIMIT_SALT: 's'.repeat(32), AUDIT_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const request = new Request('https://api.example/api/audits', { method: 'POST', headers: { Origin: 'https://staging.example', 'content-type': 'application/json' }, body: JSON.stringify({ pdfBase64: pdf, sessionId: job, turnstileToken: 'test-token' }) });
  // Crypto work uses the event loop independently of fake timers.
  const pending = handleRequest(request, fullEnv, { database: db, fetcher });
  await providerStarted;
  expect((await settle(pending)).status).toBe(recover ? 200 : 503);
  expect(db.startJob).toHaveBeenCalledTimes(1); expect(db.completeJob).toHaveBeenCalledTimes(recover ? 1 : 0);
  expect(db.failJob).toHaveBeenCalledTimes(recover ? 0 : 1); expect(db.captureLead).not.toHaveBeenCalled(); expect(db.recordEvent).not.toHaveBeenCalled();
});
