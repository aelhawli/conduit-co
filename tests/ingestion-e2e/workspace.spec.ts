import {test,expect,type Page} from '@playwright/test';
const org='10000000-0000-4000-8000-000000000001',project='20000000-0000-4000-8000-000000000001',version='30000000-0000-4000-8000-000000000001';
const pdf={name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSynthetic transport fixture\n%%EOF')};
async function setup(page:Page){
 const calls:{action:string;data:Record<string,unknown>}[]=[],parts:Buffer[]=[];
 const v={id:version,document_id:version,project_id:project,organisation_id:org,original_filename:pdf.name,declared_bytes:pdf.buffer.length,state:'UPLOADING',version:1,page_count:2,source_deleted_at:null,upload:{multipart_id:'synthetic',state:'UPLOADING',part_digests:{},expires_at:new Date(Date.now()+86400000).toISOString()},job:{state:'PROCESSING',pages_prepared:1,error_code:null},fingerprint:''};
 let reserved=false;
 await page.addInitScript(({org})=>{
  const exp=Math.floor(Date.now()/1000)+3600;const user={id:org,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  const token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:org,aud:'authenticated',exp}))+'.synthetic';
  localStorage.setItem('conduit-ingestion-staging-auth',JSON.stringify({access_token:token,refresh_token:'synthetic-test',expires_at:exp,expires_in:3600,token_type:'bearer',user}));
 },{org});
 await page.route('https://kvujhszkrblaovnksafx.supabase.co/**',r=>r.fulfill({status:200,json:{}}));
 await page.route('https://challenges.cloudflare.com/**',r=>r.fulfill({contentType:'text/javascript',body:"window.turnstile={render:(e,o)=>{window.challenge=o;o.callback('synthetic');return 'one'},reset:()=>window.challenge.callback('synthetic')}"}));
 await page.route('https://531521b13c35aabe7b97954af0e2169b.r2.cloudflarestorage.com/**',r=>{parts.push(r.request().postDataBuffer()!);return r.fulfill({status:200,headers:{etag:'test-part'}});});
 await page.route('https://conduit-ingestion-staging.letstalk-531.workers.dev/control',async r=>{
  const body=r.request().postDataJSON();calls.push(body);const {action,data}=body;let result:unknown={};
  if(action==='organisations')result=[{id:org,name:'Synthetic organisation'}];
  else if(action==='projects')result=[{id:project,name:'Synthetic tender'}];
  else if(action==='project')result={name:'<img src=x onerror=alert(1)> tender',reserved_bytes:reserved?v.declared_bytes:0,documents:reserved?[v]:[]};
  else if(action==='reserve'){reserved=true;v.fingerprint=data.fingerprint;result=v;}
  else if(action==='version'||action==='resume')result={...v,parts:[]};
  else if(action==='part')result={url:'https://531521b13c35aabe7b97954af0e2169b.r2.cloudflarestorage.com/conduit-ingestion-staging/test',headers:{'Content-MD5':data.digest}};
  else if(action==='complete'){v.state='PROCESSING';result={accepted:true};}
  await r.fulfill({json:result});
 });
 await page.goto('/');await page.getByRole('button',{name:'Synthetic tender',exact:true}).click();
 return {calls,parts,v};
}
test('direct storage upload and durable processing survive refresh',async({page})=>{
 const state=await setup(page);await page.locator('#files').setInputFiles(pdf);await page.locator('#upload').click();
 await expect(page.locator('#documents')).toContainText('Preparing pages: 1 of 2');expect(state.parts).toHaveLength(1);expect(state.parts[0]).toEqual(pdf.buffer);
 expect(state.calls.some(c=>JSON.stringify(c).includes('Synthetic transport fixture'))).toBe(false);
 await page.reload();await expect(page.locator('#documents')).toContainText('Preparing pages: 1 of 2');expect(state.calls.filter(c=>c.action==='reserve')).toHaveLength(1);
 expect(await page.locator('#tender-name img').count()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('invalid file never requests reservation or object storage',async({page})=>{
 const state=await setup(page);await page.locator('#files').setInputFiles({...pdf,name:'not-pdf.exe'});await page.locator('#upload').click();await expect(page.locator('#message')).toContainText('Choose a PDF');expect(state.parts).toHaveLength(0);expect(state.calls.filter(c=>c.action==='reserve')).toHaveLength(0);
});
test('idempotent reservation result does not duplicate storage uploads or completion',async({page})=>{
 const state=await setup(page);await page.locator('#files').setInputFiles([pdf,{...pdf,name:'second.pdf'}]);await page.locator('#upload').click();await expect.poll(()=>state.calls.filter(c=>c.action==='reserve').length).toBe(2);
 // The mock intentionally returns the previously received version on the second reservation.
 // The browser must not upload or create another job for that idempotent result.
 expect(state.parts).toHaveLength(1);expect(state.calls.filter(c=>c.action==='complete')).toHaveLength(1);
});

