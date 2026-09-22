import { z } from 'zod';

export const MAX_PDF_BYTES = 7 * 1024 * 1024;
export const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_PDF_BYTES / 3);
export const MAX_AUDIT_BODY_BYTES = MAX_BASE64_LENGTH + 4096;
export const trades = ['Electrical', 'Plumbing', 'HVAC/Mechanical', 'General Subbie'] as const;
const uuid = z.string().uuid();
const token = z.string().regex(/^[a-f0-9]{64}$/);
const shortText = (max: number) => z.string().trim().min(1).max(max).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
export const auditRequestSchema = z.object({
  pdfBase64: z.string().min(8).max(MAX_BASE64_LENGTH),
  sessionId: uuid,
  turnstileToken: z.string().min(1).max(2048)
}).strict();
export const auditSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  topRisks: z.array(z.object({ title: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(2000) }).strict()).max(3)
}).strict();
export type Audit = z.infer<typeof auditSchema>;
const attributionValue = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const attributionSchema = z.object({
  source: attributionValue.optional(), medium: attributionValue.optional(), campaign: attributionValue.optional(),
  referralHost: z.string().max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/).optional()
}).strict();
export const leadRequestSchema = z.object({
  jobId: uuid, auditToken: token,
  name: shortText(120), company: shortText(160), email: z.string().trim().email().max(254),
  mobile: z.string().trim().regex(/^\+?[0-9 ()-]{8,24}$/).refine(v => { const n = v.replace(/\D/g, '').length; return n >= 8 && n <= 15; }),
  trade: z.enum(trades), attribution: attributionSchema,
  contactConsent: z.literal(true), website: z.string().max(0)
}).strict();
export type LeadRequest = z.infer<typeof leadRequestSchema>;
export const clientEventSchema = z.discriminatedUnion('name', [
  z.object({ eventId: uuid, sessionId: uuid, name: z.enum(['landing_page_visit', 'tender_upload_started']) }).strict(),
  z.object({ eventId: uuid, sessionId: uuid, name: z.enum(['lead_form_displayed', 'audit_unlocked']), jobId: uuid, auditToken: token }).strict()
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;
export const auditResponseSchema = z.object({ success: z.literal(true), jobId: uuid, auditToken: token, summary: z.string(), expiresAt: z.string() });
export const leadResponseSchema = z.object({ success: z.literal(true), audit: auditSchema });
