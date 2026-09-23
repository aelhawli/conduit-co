import {describe,it,expect} from 'vitest';
import {IngestionDatabase} from '../src/ingestion/database';
const env={SUPABASE_URL:'https://kvujhszkrblaovnksafx.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'};
describe('Ingestion runtime transport',()=>{
 it('invokes authentication and RPC fetch with the global receiver required by Workers',async()=>{
  let calls=0;
  const fetcher=function(this:unknown){expect(this).toBe(globalThis);calls++;return Promise.resolve(Response.json(calls===1?{id:'synthetic-user',is_anonymous:false}:[]));} as typeof fetch;
  const db=new IngestionDatabase(env,fetcher);
  expect(await db.authenticate('synthetic-token')).toBe('synthetic-user');
  expect(await db.rpc('organisations',{},'synthetic-token')).toEqual([]);
  expect(calls).toBe(2);
 });
});
