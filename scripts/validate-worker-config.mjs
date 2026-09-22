export function validateWorkerConfig(config) {
  const secretNames = ['GEMINI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'RATE_LIMIT_SALT'];
  for (const section of [config, ...Object.values(config.env ?? {})]) {
    if (secretNames.some(name => Object.hasOwn(section.vars ?? {}, name))) throw new Error('Secrets must not be configured as plaintext vars');
  }
  const staging = config.env.staging, production = config.env.production;
  if (staging.name === production.name || new URL(staging.vars.SUPABASE_URL).origin === new URL(production.vars.SUPABASE_URL).origin) throw new Error('Environment resources must be separate');
  const namespaces = [...staging.ratelimits, ...production.ratelimits].map(binding => binding.namespace_id);
  if (new Set(namespaces).size !== namespaces.length) throw new Error('Rate limit namespaces must be separate');
  const productionOrigins = ['https://conduitco.io', 'https://conduit-co.pages.dev'];
  for (const [name, section] of Object.entries(config.env)) {
    if (section.vars.ENVIRONMENT !== name) throw new Error('Environment identity mismatch');
    const database = new URL(section.vars.SUPABASE_URL);
    if (database.protocol !== 'https:' || database.origin !== section.vars.SUPABASE_URL.toLowerCase() || !database.hostname.endsWith('.supabase.co')) throw new Error('Invalid Supabase origin');
    for (const origin of section.vars.ALLOWED_ORIGINS.split(',').map(value => value.trim())) {
      const url = new URL(origin);
      if (url.origin !== origin || origin.includes('*')) throw new Error('CORS requires exact origins');
      if (name === 'production' ? !productionOrigins.includes(origin) : productionOrigins.includes(origin)) throw new Error('CORS environment mismatch');
    }
  }
}
