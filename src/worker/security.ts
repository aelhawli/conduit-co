import { MAX_PDF_BYTES } from '../shared/contracts';
import { AppError, unavailable } from './errors';

export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export function newToken(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }

export function validatePdf(base64: string): void {
  if (base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new AppError(400, 'INVALID_PDF', 'Please select a valid PDF file.');
  }
  const decodedSize = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (decodedSize > MAX_PDF_BYTES) throw new AppError(413, 'REQUEST_TOO_LARGE', 'Maximum PDF size is 7 MiB.');
  // Basic format checks only, not malware scanning or complete PDF parsing.
  const start = atob(base64.slice(0, 1024));
  const tail = atob(base64.slice(Math.max(0, base64.length - 2048)));
  if (!start.startsWith('%PDF-') || !tail.includes('%%EOF')) throw new AppError(400, 'INVALID_PDF', 'Please select a complete, valid PDF file.');
}

export async function checkTurnstile(token: string, hostname: string, secret: string, fetcher: typeof fetch): Promise<void> {
  if (!secret) throw unavailable();
  let result: { success?: boolean; hostname?: string; action?: string };
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw unavailable();
    result = await response.json();
  } catch { throw unavailable(); }
  if (!result.success || result.hostname !== hostname || result.action !== 'audit') {
    throw new AppError(403, 'VERIFICATION_FAILED', 'Please complete the security check again.');
  }
}
