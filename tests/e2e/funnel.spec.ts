import { test, expect, type Page } from '@playwright/test';
const job='22222222-2222-4222-8222-222222222222';
const token='a'.repeat(64);
const risk = '<img src=x onerror=alert(1)> Scope risk';
const pdf = {name:'drawing.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')};
async function setup(page: Page, options: { failLead?:boolean; failAudit?:boolean; delayAudit?:boolean } = {}) {
  const events: Record<string,unknown>[]=[];
  const leads: Record<string,unknown>[]=[];
  await page.route('https://challenges.cloudflare.com/**', route=>route.fulfill({contentType:'text/javascript',body:`window.turnstile={render:(el,o)=>{window.testChallenge=o; o.callback('test-token'); return 'widget';},reset:()=>window.testChallenge.callback('test-token')};window.conduitTurnstileReady();`}));
  await page.route('http://127.0.0.1:8787/**', async route=>{
    const url=new URL(route.request().url());
    if(route.request().method()==='OPTIONS') { await route.fulfill({status:204,headers:{'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-methods':'POST','access-control-allow-headers':'content-type'}}); return; }
    const headers={'access-control-allow-origin':'http://127.0.0.1:4173'};
    if(url.pathname==='/api/events') { events.push(route.request().postDataJSON()); await route.fulfill({headers,json:{success:true}}); }
    else if(url.pathname==='/api/audits') {
      if(options.delayAudit) await new Promise(resolve=>setTimeout(resolve,400));
      await route.fulfill({headers,status:options.failAudit?502:200,json:options.failAudit?{error:{code:'AUDIT_FAILED'}}:{success:true,jobId:job,auditToken:token,summary:'Electrical scope summary.',expiresAt:new Date(Date.now()+86400000).toISOString()}});
    } else if(url.pathname==='/api/leads') {
      leads.push(route.request().postDataJSON());
      await route.fulfill({headers,status:options.failLead?503:200,json:options.failLead?{error:{code:'SERVICE_UNAVAILABLE'}}:{success:true,audit:{summary:'Summary',topRisks:[{title:risk,description:'Check the drawing legend.'}]}}});
    } else await route.abort();
  });
  await page.goto('/'); return {events,leads};
}
async function audit(page: Page) { await page.locator('#pdf-input').setInputFiles(pdf); await page.locator('#scan-btn').click(); await expect(page.locator('#lead-form')).toBeVisible(); }
async function fillLead(page: Page) {
  await page.getByLabel('Full name').fill('Test Person'); await page.getByLabel('Company',{exact:true}).fill('Test Electrical');
  await page.getByLabel('Work email').fill('test@example.com'); await page.getByLabel('Mobile',{exact:true}).fill('0400000000');
  await page.getByLabel('Primary trade').selectOption('Electrical'); await page.locator('#lead-consent').check();
}
test('free audit → saved lead → safe unlock, with privacy-safe event payloads',async({page},testInfo)=>{
  const {events,leads}=await setup(page); await audit(page);
  await expect(page.locator('#audit-summary')).toHaveText('Electrical scope summary.'); await expect(page.locator('#risk-list')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('lead-gate.png'),fullPage:true});
  await fillLead(page); await page.locator('#unlock-btn').click();
  await expect(page.locator('#risk-list')).toContainText(risk); await expect(page.locator('#risk-list img')).toHaveCount(0); await expect(page.locator('#lead-gate')).toBeHidden();
  await page.screenshot({path:testInfo.outputPath('unlocked.png'),fullPage:true});
  expect(leads).toHaveLength(1); expect(leads[0]).toMatchObject({name:'Test Person',company:'Test Electrical',email:'test@example.com',mobile:'0400000000',trade:'Electrical',jobId:job,contactConsent:true});
  await expect.poll(()=>events.map(e=>e.name)).toEqual(expect.arrayContaining(['landing_page_visit','tender_upload_started','lead_form_displayed','audit_unlocked']));
  expect(JSON.stringify(events)).not.toMatch(/Test Person|test@example.com|drawing.pdf|Scope risk|pdfBase64/);
  await page.locator('#pdf-input').setInputFiles({...pdf,name:'second.pdf'}); await expect(page.locator('#results')).toBeHidden();
  await page.locator('#scan-btn').click(); await expect(page.locator('#lead-gate')).toBeVisible(); await expect(page.locator('#risk-list')).toBeHidden();
});
test('failed lead save keeps form and results gate, permits retry',async({page})=>{
  const options={failLead:true}; const {leads}=await setup(page,options); await audit(page); await fillLead(page); await page.locator('#unlock-btn').click();
  await expect(page.locator('#lead-error')).toBeVisible(); await expect(page.locator('#lead-gate')).toBeVisible(); await expect(page.locator('#risk-list')).toBeHidden();
  await expect(page.getByLabel('Full name')).toHaveValue('Test Person'); options.failLead=false; await page.locator('#unlock-btn').click();
  await expect(page.locator('#risk-list')).toBeVisible(); expect(leads).toHaveLength(2);
});
test('failed second audit cannot show stale prior results',async({page})=>{
  const options={failAudit:false}; await setup(page,options); await audit(page); options.failAudit=true;
  await page.locator('#pdf-input').setInputFiles({...pdf,name:'failed.pdf'}); await page.locator('#scan-btn').click();
  await expect(page.locator('#audit-error')).toBeVisible(); await expect(page.locator('#results')).toBeHidden(); await expect(page.locator('#scan-btn')).toBeEnabled();
});
test('changing the file during analysis discards the old response',async({page})=>{
  await setup(page,{delayAudit:true}); await page.locator('#pdf-input').setInputFiles(pdf); await page.locator('#scan-btn').click();
  await page.locator('#pdf-input').setInputFiles({...pdf,name:'replacement.pdf'}); await expect(page.locator('#file-label')).toContainText('replacement.pdf');
  await expect(page.locator('#results')).toBeHidden(); await expect(page.locator('#scan-btn')).toBeEnabled();
});
test('rejects a non-PDF without an API audit request',async({page})=>{
  await setup(page); let requests=0; page.on('request',r=>{if(r.url().endsWith('/api/audits'))requests++;});
  await page.locator('#pdf-input').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('text')}); await page.locator('#scan-btn').click();
  await expect(page.locator('#audit-error')).toContainText('PDF'); expect(requests).toBe(0);
});
