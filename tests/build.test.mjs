import { describe, expect, it } from 'vitest';
import { apiOrigins, buildEnvironment } from '../scripts/build-environment.mjs';
import { readFileSync } from 'node:fs';
import { validateWorkerConfig } from '../scripts/validate-worker-config.mjs';

describe('release environment isolation', () => {
  it('uses separate fixed API destinations', () => {
    expect(buildEnvironment('staging', {}).api).toBe(apiOrigins.staging);
    expect(buildEnvironment('test', {}).api).toBe(apiOrigins.test);
    expect(apiOrigins.staging).not.toBe(apiOrigins.production);
  });
  it.each(['staging', 'test'])('rejects production API overrides in %s', environment => {
    expect(() => buildEnvironment(environment, { PUBLIC_API_BASE_URL: apiOrigins.production })).toThrow(/match/);
  });
  it.each(['CF_PAGES', 'CF_PAGES_BRANCH', 'CF_PAGES_URL'])('rejects production compilation in Pages with %s', name => {
    expect(() => buildEnvironment('production', { [name]: 'preview', PUBLIC_TURNSTILE_SITE_KEY: 'synthetic-widget' })).toThrow(/manual/);
  });
  it('rejects a production build without a real widget identifier', () => {
    expect(() => buildEnvironment('production', {})).toThrow(/TURNSTILE/);
    expect(() => buildEnvironment('production', { PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' })).toThrow(/TURNSTILE/);
  });
  it('rejects arbitrary API hosts even for manual production builds', () => {
    expect(() => buildEnvironment('production', { PUBLIC_API_BASE_URL: 'https://other.example', PUBLIC_TURNSTILE_SITE_KEY: 'synthetic-widget' })).toThrow(/match/);
  });
});

describe('Worker configuration isolation', () => {
  const fresh = () => JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  it('accepts the reviewed environment configuration', () => expect(() => validateWorkerConfig(fresh())).not.toThrow());
  it.each(['name', 'database', 'namespace', 'cors', 'secret'])('rejects unsafe %s configuration', field => {
    const config = fresh(), staging = config.env.staging, production = config.env.production;
    if (field === 'name') staging.name = production.name;
    if (field === 'database') staging.vars.SUPABASE_URL = production.vars.SUPABASE_URL;
    if (field === 'namespace') staging.ratelimits[0].namespace_id = production.ratelimits[0].namespace_id;
    if (field === 'cors') staging.vars.ALLOWED_ORIGINS = 'https://conduitco.io';
    if (field === 'secret') production.vars.GEMINI_API_KEY = 'synthetic-misconfiguration';
    expect(() => validateWorkerConfig(config)).toThrow();
  });
});
