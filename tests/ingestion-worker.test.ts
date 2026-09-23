import {afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('@cloudflare/containers',()=>({Container:class{},ContainerProxy:class{}}));
import {handleIngestion,retentionDays} from '../src/ingestion/worker';
const origin='https://conduit-ingestion-staging.pages.dev';
const env={ENVIRONMENT:'staging',SUPABASE_URL:'https://kvujhszkrblaovnksafx.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic',R2_ACCOUNT_ID:'531521b13c35aabe7b97954af0e2169b',R2_BUCKET:'conduit-ingestion-staging',R2_ACCESS_KEY_ID:'synthetic',R2_SECRET_ACCESS_KEY:'synthetic',RATE_LIMIT_SALT:'s'.repeat(64),CONTROL_LIMITER:{limit:async()=>({success:true})}} as unknown as Parameters<typeof handleIngestion>[1];
function request(body:string,headers:Record<string,string>={}){return new Request('https://conduit-ingestion-staging.letstalk-531.workers.dev/control',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',Authorization:'Bearer synthetic',...headers},body});}
afterEach(()=>vi.unstubAllGlobals());
describe('Ingestion Worker control boundary',()=>{
 it('rejects production origin without issuing storage or database requests',async()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const r=await handleIngestion(request('{}',{Origin:'https://conduitco.io'}),env);expect(r.status).toBe(403);expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();expect(fetcher).not.toHaveBeenCalled();});
 it('rejects oversized control metadata with 413 instead of a transient service failure',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'synthetic-user'})));const r=await handleIngestion(request(JSON.stringify({padding:'x'.repeat(8200)})),env);expect(r.status).toBe(413);expect((await r.json() as {error:string}).error).toBe('REQUEST_TOO_LARGE');});
 it('rejects invalid JSON as permanent client input',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'synthetic-user'})));const r=await handleIngestion(request('{'),env);expect(r.status).toBe(400);});
 it('requires authentication before control operations',async()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const r=await handleIngestion(request('{}',{Authorization:''}),env);expect(r.status).toBe(401);expect(fetcher).not.toHaveBeenCalled();});
});

it('bounds explicit source and derived retention configuration',()=>{expect(retentionDays('30','90')).toEqual({source_days:30,derived_days:90});for(const [source,derived] of [['0','90'],['30','366'],['90','30'],['bad','90']])expect(()=>retentionDays(source,derived)).toThrow();});
