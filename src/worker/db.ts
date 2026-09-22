import { z } from 'zod';
import { auditSchema, type Audit, type ClientEvent, type LeadRequest } from '../shared/contracts';
import { AppError, unavailable } from './errors';

export interface Database {
  startJob(jobId: string, tokenHash: string, sessionId: string): Promise<void>;
  completeJob(jobId: string, audit: Audit): Promise<void>;
  failJob(jobId: string): Promise<void>;
  captureLead(lead: LeadRequest, tokenHash: string): Promise<Audit>;
  recordEvent(event: ClientEvent, tokenHash?: string): Promise<void>;
}

export class SupabaseDatabase implements Database {
  constructor(private env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string; GEMINI_MODEL: string; DAILY_AUDIT_LIMIT: string }, private fetcher: typeof fetch) {}
  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.env.SUPABASE_URL || !this.env.SUPABASE_SERVICE_ROLE_KEY) throw unavailable();
    try {
      // Workers' native fetch rejects a database instance as its `this` receiver.
      const fetcher = this.fetcher;
      const response = await fetcher(`${this.env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: this.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw unavailable();
      return await response.json();
    } catch { throw unavailable(); }
  }
  async startJob(jobId: string, tokenHash: string, sessionId: string): Promise<void> {
    const limit = Number(this.env.DAILY_AUDIT_LIMIT);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw unavailable();
    const ok = await this.rpc('start_funnel_audit', { p_job_id: jobId, p_token_hash: tokenHash, p_session_id: sessionId, p_model: this.env.GEMINI_MODEL, p_daily_limit: limit });
    if (ok !== true) throw new AppError(429, 'AUDIT_CAPACITY', 'The free audit service has reached its daily capacity. Please try again tomorrow.');
  }
  async completeJob(jobId: string, audit: Audit): Promise<void> {
    if (await this.rpc('complete_funnel_audit', { p_job_id: jobId, p_audit: audit }) !== true) throw unavailable();
  }
  async failJob(jobId: string): Promise<void> { await this.rpc('fail_funnel_audit', { p_job_id: jobId }); }
  async captureLead(lead: LeadRequest, tokenHash: string): Promise<Audit> {
    const result = await this.rpc('capture_funnel_lead', { p_job_id: lead.jobId, p_token_hash: tokenHash, p_name: lead.name, p_company: lead.company, p_email: lead.email.toLowerCase(), p_mobile: lead.mobile, p_trade: lead.trade, p_attribution: lead.attribution, p_consent_version: 'audit-contact-v1' });
    if (result === null) throw new AppError(404, 'AUDIT_UNAVAILABLE', 'This audit has expired or could not be found. Please run a new audit.');
    const parsed = auditSchema.safeParse(result);
    if (!parsed.success) throw unavailable();
    return parsed.data;
  }
  async recordEvent(event: ClientEvent, tokenHash?: string): Promise<void> {
    const ok = await this.rpc('record_funnel_event', { p_event_id: event.eventId, p_session_id: event.sessionId, p_name: event.name, p_job_id: 'jobId' in event ? event.jobId : null, p_token_hash: tokenHash ?? null });
    if (!z.boolean().parse(ok)) throw new AppError(404, 'AUDIT_UNAVAILABLE', 'This audit could not be found.');
  }
}
