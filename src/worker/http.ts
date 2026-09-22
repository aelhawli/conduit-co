import { AppError } from './errors';

// Bound reads before JSON parsing; Content-Length alone is not trustworthy.
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Please send a JSON request.');
  }
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new AppError(413, 'REQUEST_TOO_LARGE', 'The uploaded file is too large. Maximum PDF size is 7 MiB.');
  if (!request.body) throw new AppError(400, 'INVALID_REQUEST', 'The request is empty.');
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError(413, 'REQUEST_TOO_LARGE', 'The uploaded file is too large. Maximum PDF size is 7 MiB.');
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new AppError(400, 'INVALID_JSON', 'The request could not be read.'); }
}

export function json(body: unknown, status: number, origin?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  if (status === 429) headers.set('Retry-After', '60');
  return new Response(JSON.stringify(body), { status, headers });
}
