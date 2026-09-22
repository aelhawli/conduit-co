import type { RateLimit as WorkerRateLimit } from '@cloudflare/workers-types';
declare global { type RateLimit = WorkerRateLimit; }
