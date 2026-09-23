import {STAGING_DB} from './contracts';
export interface DatabaseEnv{SUPABASE_URL:string;SUPABASE_PUBLISHABLE_KEY:string;SUPABASE_SERVICE_ROLE_KEY:string}
export class IngestionDatabase{
 constructor(readonly env:DatabaseEnv,readonly fetcher:typeof fetch=fetch){if(env.SUPABASE_URL!==STAGING_DB)throw new Error('ENVIRONMENT_MISMATCH');}
 async authenticate(token:string){
  const r=await this.fetcher(`${STAGING_DB}/auth/v1/user`,{headers:{apikey:this.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('UNAUTHENTICATED');const user=await r.json() as {id?:string;is_anonymous?:boolean};if(!user.id||user.is_anonymous)throw new Error('UNAUTHENTICATED');return user.id;
 }
 async rpc<T>(action:string,payload:Record<string,unknown>,token?:string):Promise<T>{
  const r=await this.fetcher(`${STAGING_DB}/rest/v1/rpc/${token?'ingestion_user':'ingestion_internal'}`,{method:'POST',headers:{apikey:token?this.env.SUPABASE_PUBLISHABLE_KEY:this.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${token??this.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(15000)});
  if(!r.ok){const error=await r.json() as {message?:string;code?:string};const code=error.code==='42501'?'FORBIDDEN':error.message;throw new Error(code&&/^[A-Z_]{1,64}$/.test(code)?code:'DATABASE_UNAVAILABLE');}return r.json() as Promise<T>;
 }
}
