import {createClient} from '@supabase/supabase-js';
import {md5,sha256} from 'hash-wasm';
import {STAGING_DB,STAGING_API,PART_BYTES,FILE_LIMIT,type Version} from './contracts';
declare const __INGESTION_PUBLIC_KEY__:string,__INGESTION_TURNSTILE_KEY__:string;
type Turnstile={render(element:HTMLElement,options:Record<string,unknown>):string;reset(id:string):void};
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const client=createClient(STAGING_DB,__INGESTION_PUBLIC_KEY__,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'conduit-ingestion-staging-auth'}});
let projectId='',files:File[]=[],paused=false,activeXHR:XMLHttpRequest|undefined,challenge='',widget='',uploading=false;
let selectedVersions:Version[]=[];
const failureMessages:Record<string,string>={INVALID_PDF:'This file is not a PDF. Choose a valid PDF.',CORRUPT_PDF:'This PDF is damaged or incomplete. Export a fresh copy and upload it again.',ENCRYPTED_PDF:'This PDF is password-protected or encrypted. Upload an unlocked copy.',PAGE_LIMIT:'This PDF exceeds the 2,000-page limit. Split it into smaller PDFs.',PAGE_DIMENSIONS:'A page has unsupported dimensions. Export a standard-size copy.',SIZE_MISMATCH:'The received file size did not match. Upload the original file again.',OUTPUT_LIMIT:'A page is too complex to prepare. Export a simpler copy.',PROCESSOR_TIMEOUT:'Preparation timed out. Try a smaller PDF.',PROCESSOR_UNAVAILABLE:'Preparation is temporarily unavailable. Please try again later.',RETRY_EXHAUSTED:'Preparation could not finish after repeated attempts. Please try again later.'};
function message(text:string){$('message').textContent=text;}
async function api<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
 const {data:{session}}=await client.auth.getSession();if(!session)throw new Error('Please sign in again. Your tender is saved.');
 const response=await fetch(STAGING_API+'/control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(45000)});
 const body=await response.json();if(!response.ok)throw new Error(response.status===403?'You do not have access to this tender. Choose a tender from your organisation.':body.message??'Request failed. Please try again.');return body as T;
}
function button(text:string,run:()=>Promise<void>){const b=document.createElement('button');b.textContent=text;b.onclick=()=>{b.disabled=true;void run().catch(e=>message(e instanceof Error?e.message:'Request failed.')).finally(()=>{b.disabled=false;});};return b;}
async function loadProjects(){const rows=await api<{id:string;name:string}[]>('projects');$('projects').replaceChildren(...rows.map(p=>button(p.name,()=>openProject(p.id))));}
async function openProject(id:string){if(uploading)throw new Error('Pause the current upload before opening another tender.');projectId=id;location.hash=id;try{await refreshProject();if(projectId===id)$('tender').hidden=false;}catch(e){if(projectId!==id)return;projectId='';location.hash='';$('tender').hidden=true;message((e as Error).message);}}
async function refreshProject(){
 if(!projectId)return;const requestedProject=projectId;
 const p=await api<{name:string;reserved_bytes:number;documents:(Version&{original_filename:string;version:number;duplicate_of:string|null;job?:{state:string;pages_prepared:number;error_code:string|null}})[]}>('project',{project_id:requestedProject});
 if(projectId!==requestedProject)return;
 $('tender-name').textContent=p.name;$('allowance').textContent=`${(p.reserved_bytes/1_000_000).toFixed(1)} MB reserved of 2,000 MB`;selectedVersions=p.documents;
 const revisions=$<HTMLSelectElement>('revision'),previous=revisions.value,newDocument=document.createElement('option');newDocument.value='';newDocument.textContent='Create new documents';
 const identities=new Map(p.documents.filter(v=>v.state!=='CANCELLED').map(v=>[v.document_id,v.original_filename]));
 revisions.replaceChildren(newDocument,...Array.from(identities,([id,name])=>{const o=document.createElement('option');o.value=id;o.textContent=`New revision of ${name}`;return o;}));revisions.value=identities.has(previous)?previous:'';
 $('documents').replaceChildren(...p.documents.map(v=>{const a=document.createElement('article'),h=document.createElement('h3'),status=document.createElement('p');h.textContent=`${v.original_filename} · Version ${v.version}`;
  const labels:Record<string,string>={UPLOADING:'Waiting for upload completion. Select the same file to resume.',UPLOADED:'Upload received. Waiting for validation.',VALIDATING:'Conduit is validating your PDF.',PROCESSING:`PDF validated. Preparing pages: ${v.job?.pages_prepared??0} of ${v.page_count??'unknown'}.`,COMPLETED:`Ready: ${v.page_count} pages validated and prepared.`,FAILED:failureMessages[v.job?.error_code??'']??'Document could not be prepared. Please try again later.',CANCELLED:'Cancelled. Cleanup is pending.'};status.textContent=labels[v.state]??v.state;
  a.append(h,status);if(v.duplicate_of){const duplicate=document.createElement('p');duplicate.textContent='Duplicate source detected in this tender. This version is recorded separately.';a.append(duplicate);}
  if(v.state!=='CANCELLED')a.append(button('Delete document',async()=>{await api('cancel',{project_id:projectId,version_id:v.id});await refreshProject();}));
  if(v.state==='COMPLETED'&&!v.source_deleted_at)a.append(button('Download original PDF',async()=>{const r=await api<{url:string}>('download',{project_id:projectId,version_id:v.id});const link=document.createElement('a');link.href=r.url;link.rel='noreferrer';link.download='tender.pdf';link.click();}));return a;
 }));
}
class UploadError extends Error{constructor(readonly retryable:boolean){super('Upload interrupted. Confirmed parts are saved; select the same file to resume.');}}
async function signedUpload(url:string,headers:Record<string,string>,blob:Blob,onProgress:(bytes:number)=>void){
 return new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();activeXHR=xhr;xhr.open('PUT',url);xhr.timeout=180000;for(const [k,v] of Object.entries(headers))xhr.setRequestHeader(k,v);xhr.upload.onprogress=e=>onProgress(e.loaded);xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new UploadError(xhr.status===429||xhr.status>=500));xhr.onerror=xhr.ontimeout=()=>reject(new UploadError(true));xhr.onabort=()=>reject(new UploadError(false));xhr.send(blob);});
}
async function fingerprint(file:File){const bytes=new Uint8Array(await new Blob([file.slice(0,65536),file.slice(Math.max(0,file.size-65536)),String(file.size)]).arrayBuffer());return sha256(bytes);}
function base64hex(hex:string){return btoa(String.fromCharCode(...hex.match(/../g)!.map(x=>parseInt(x,16))));}
async function upload(file:File){
 if(!/\.pdf$/i.test(file.name)||file.size<1||file.size>FILE_LIMIT)throw new Error('Choose a PDF between 1 byte and 250 MB.');
 const fp=await fingerprint(file),documentId=$<HTMLSelectElement>('revision').value;
 const storageKey=`conduit-upload:${projectId}:${documentId||'new'}:${fp}`;
 let version=selectedVersions.find(v=>v.state==='UPLOADING'&&(!documentId||v.document_id===documentId)&&(v as Version&{original_filename:string}).original_filename===file.name&&v.declared_bytes===file.size);
 if(version){version=await api<Version>('resume',{project_id:projectId,version_id:version.id});if((version as Version&{fingerprint:string}).fingerprint!==fp)throw new Error('The selected file differs from the saved upload. Choose the original file.');}
 else{
  if(!challenge){message('Complete the security check to start the next PDF.');const deadline=Date.now()+120000;while(!challenge&&!paused&&Date.now()<deadline)await new Promise(r=>setTimeout(r,250));if(!challenge||paused)throw new Error('Upload paused. Complete the security check and select Upload to continue.');}
  const idempotency_key=localStorage.getItem(storageKey)??crypto.randomUUID();localStorage.setItem(storageKey,idempotency_key);
  try{version=await api<Version>('reserve',{project_id:projectId,document_id:documentId||undefined,filename:file.name,media_type:'application/pdf',byte_size:file.size,fingerprint:fp,idempotency_key,turnstileToken:challenge});}finally{challenge='';const turnstile=(window as unknown as {turnstile?:Turnstile}).turnstile;if(widget)turnstile?.reset(widget);}
 }
 const v=await api<Version&{parts:{part:number;bytes:number}[]}>('version',{project_id:projectId,version_id:version.id});
 if(v.state!=='UPLOADING'){message('This upload is already received.');return;}
 if(v.upload?.state==='COMPLETING'){await api('complete',{project_id:projectId,version_id:v.id});await refreshProject();return;}
 const confirmed=new Set(v.parts.map(p=>p.part));let sent=v.parts.reduce((sum,p)=>sum+p.bytes,0);const progress=$<HTMLProgressElement>('progress');progress.max=file.size;progress.value=sent;
 for(let part=1;part<=Math.ceil(file.size/PART_BYTES);part++){
  if(paused)throw new Error('Upload paused. Select the same file to resume.');
  const blob=file.slice((part-1)*PART_BYTES,Math.min(file.size,part*PART_BYTES));
  const digest=base64hex(await md5(new Uint8Array(await blob.arrayBuffer())));
  // Verify every confirmed part against its stored digest before skipping it.
  if(confirmed.has(part)){if(v.upload?.part_digests[String(part)]!==digest)throw new Error('The file changed. Choose the original PDF or cancel this upload.');continue;}
  $('upload-label').textContent=`Uploading ${file.name}: part ${part} of ${Math.ceil(file.size/PART_BYTES)}`;
  for(let attempt=0;attempt<3;attempt++){
   if(paused)throw new Error('Upload paused. Select the same file to resume.');
   const permission=await api<{url:string;headers:Record<string,string>}>('part',{project_id:projectId,version_id:v.id,part,digest});
   try{await signedUpload(permission.url,permission.headers,blob,bytes=>{progress.value=sent+bytes;});break;}
   catch(e){progress.value=sent;if(!(e instanceof UploadError)||!e.retryable||attempt===2||paused)throw e;message('Connection interrupted. Retrying this part; confirmed parts are saved.');await new Promise(r=>setTimeout(r,1000*2**attempt+Math.random()*500));}
  }
  sent+=blob.size;progress.value=sent;
 }
 await api('complete',{project_id:projectId,version_id:v.id});localStorage.removeItem(storageKey);$('upload-label').textContent=`Upload complete: ${file.name}`;message('Upload received. Processing continues if you close this page.');await refreshProject();
}
$<HTMLFormElement>('login').onsubmit=async e=>{e.preventDefault();const r=await client.auth.signInWithPassword({email:$<HTMLInputElement>('email').value,password:$<HTMLInputElement>('password').value});$<HTMLInputElement>('password').value='';if(r.error)message('Sign-in failed. Check your invited account details.');else try{await start();}catch(e){message((e as Error).message);}};
$<HTMLFormElement>('create').onsubmit=async e=>{e.preventDefault();if(uploading){message('Pause the current upload before creating another tender.');return;}try{const p=await api<{id:string}>('create_project',{id:crypto.randomUUID(),organisation_id:$<HTMLSelectElement>('organisation').value,name:$<HTMLInputElement>('project-name').value});await loadProjects();await openProject(p.id);}catch(e){message((e as Error).message);}};
$('logout').onclick=async()=>{paused=true;activeXHR?.abort();await client.auth.signOut();for(const key of Object.keys(localStorage))if(key.startsWith('conduit-upload:'))localStorage.removeItem(key);location.reload();};
$<HTMLInputElement>('files').onchange=e=>{files=Array.from((e.target as HTMLInputElement).files??[]);message(`${files.length} PDFs selected.`);};
$('drop').ondragover=e=>{e.preventDefault();};$('drop').ondrop=e=>{e.preventDefault();files=Array.from(e.dataTransfer?.files??[]);message(`${files.length} PDFs selected.`);};
$('pause').onclick=()=>{paused=true;activeXHR?.abort();};
$('upload').onclick=async()=>{if(uploading)return;if($<HTMLSelectElement>('revision').value&&files.length!==1){message('Select one PDF for a new document revision.');return;}paused=false;uploading=true;$<HTMLSelectElement>('revision').disabled=true;$<HTMLButtonElement>('pause').disabled=false;$<HTMLButtonElement>('upload').disabled=true;try{for(const file of files)await upload(file);}catch(e){message((e as Error).message);}finally{uploading=false;$<HTMLSelectElement>('revision').disabled=false;$<HTMLButtonElement>('pause').disabled=true;$<HTMLButtonElement>('upload').disabled=false;}};
$('delete-project').onclick=async()=>{if(uploading){message('Pause the upload before deleting this tender.');return;}if(!confirm('Delete this tender and all its documents?'))return;try{await api('delete_project',{project_id:projectId});projectId='';location.hash='';$('tender').hidden=true;message('Tender deleted. Document cleanup is scheduled.');await loadProjects();}catch(e){message((e as Error).message);}};
async function start(){const {data:{session}}=await client.auth.getSession();if(!session)return;$('login').hidden=true;$('workspace').hidden=false;const organisations=await api<{id:string;name:string}[]>('organisations');$('organisation').replaceChildren(...organisations.map(o=>{const option=document.createElement('option');option.value=o.id;option.textContent=o.name;return option;}));await loadProjects();if(/^[a-f0-9-]{36}$/.test(location.hash.slice(1)))await openProject(location.hash.slice(1));}
const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.onload=()=>{const turnstile=(window as unknown as {turnstile:Turnstile}).turnstile;widget=turnstile.render($('turnstile'),{sitekey:__INGESTION_TURNSTILE_KEY__,action:'audit',callback:(token:string)=>{challenge=token;},'expired-callback':()=>{challenge='';}});};document.head.append(script);
void start().catch(e=>message((e as Error).message));setInterval(()=>{if(projectId&&!document.hidden){const requestedProject=projectId;void refreshProject().catch(()=>{if(projectId===requestedProject)message('Connection interrupted. Your tender is saved; refresh when connected.');});}},5000);
