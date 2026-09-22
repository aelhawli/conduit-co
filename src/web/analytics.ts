import type { ClientEvent } from '../shared/contracts';

// Random identifier scoped to this page. Never store contact details or audit tokens.
export const sessionId = crypto.randomUUID();
export function attributionFrom(location: string, referrer: string): Record<string, string> {
  const params = new URL(location).searchParams;
  const attribution: Record<string, string> = {};
  for (const [key, param] of [['source','utm_source'],['medium','utm_medium'],['campaign','utm_campaign']] as const) {
    const value = params.get(param);
    if (value && /^[a-zA-Z0-9_-]{1,80}$/.test(value)) attribution[key] = value;
  }
  try {
    const ref = new URL(referrer);
    if (['http:', 'https:'].includes(ref.protocol) && ref.hostname !== new URL(location).hostname && /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,63}$/.test(ref.hostname)) attribution.referralHost = ref.hostname;
  } catch { /* Empty/invalid referrer is normal. */ }
  return attribution;
}

export async function sendEvent(baseUrl: string, event: ClientEvent): Promise<void> {
  // A single retry with the same event ID; analytics must never block the funnel.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(5000), keepalive: true });
      if (response.ok || response.status < 500) return;
    } catch { /* Best effort: do not leak payloads into logs. */ }
  }
}
