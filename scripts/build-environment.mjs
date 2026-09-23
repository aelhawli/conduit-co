// Changing an API destination requires a reviewed source change, not a build-variable override.
export const apiOrigins = Object.freeze({
  staging: 'https://conduit-api-staging.letstalk-531.workers.dev',
  production: 'https://conduit-api-production.letstalk-531.workers.dev',
  test: 'http://127.0.0.1:8787'
});

export function buildEnvironment(environment, variables = process.env) {
  if (!Object.hasOwn(apiOrigins, environment)) throw new Error('Unknown build environment');
  // M1 releases are manual. Cloudflare Git builds must not produce production artifacts.
  if (environment === 'production' && (variables.CF_PAGES || variables.CF_PAGES_BRANCH || variables.CF_PAGES_URL)) {
    throw new Error('Production builds are manual only; Pages builds cannot target production');
  }
  const api = variables.PUBLIC_API_BASE_URL || apiOrigins[environment];
  if (api !== apiOrigins[environment]) throw new Error('API origin does not match the selected environment');
  const siteKey = variables.PUBLIC_TURNSTILE_SITE_KEY || (environment === 'test' ? '1x00000000000000000000AA' : '');
  if (environment === 'production' && (!siteKey || /^[123]x000/.test(siteKey))) throw new Error('Production requires a real PUBLIC_TURNSTILE_SITE_KEY');
  return { api, siteKey };
}
