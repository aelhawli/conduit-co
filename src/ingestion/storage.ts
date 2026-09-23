import {S3Client,CreateMultipartUploadCommand,UploadPartCommand,ListPartsCommand,CompleteMultipartUploadCommand,HeadObjectCommand,AbortMultipartUploadCommand,GetObjectCommand,DeleteObjectCommand,ListObjectsV2Command,PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {PART_BYTES,partSize,type Version} from './contracts';
export interface StorageEnv{R2_ACCESS_KEY_ID:string;R2_SECRET_ACCESS_KEY:string;R2_ACCOUNT_ID:string;R2_BUCKET:string}
export class IngestionStorage{
 readonly client:S3Client;
 constructor(readonly env:StorageEnv){
  if(env.R2_ACCOUNT_ID!=='531521b13c35aabe7b97954af0e2169b'||env.R2_BUCKET!=='conduit-ingestion-staging')throw new Error('ENVIRONMENT_MISMATCH');
  this.client=new S3Client({region:'auto',forcePathStyle:true,endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',maxAttempts:3});
  this.client.middlewareStack.add((next,context)=>async args=>{
   const result=await next(args);
   // Presigning performs no network call and has no response metadata.
   const metadata=result.output?.$metadata;
   if(metadata){const key=(args.input as {Key?:string;Prefix?:string}).Key??(args.input as {Prefix?:string}).Prefix??'';const id=key.split('/')[4]?.replace(/\.pdf$/,'');
    console.info(JSON.stringify({event:'ingestion_r2_operation',operation:context.commandName,value:metadata.attempts??1,...(id&&/^[a-f0-9-]{36}$/.test(id)?{versionId:id}:{})}));}
   return result;
  },{step:'initialize',name:'ingestionMetrics'});
 }
 input(v:Version){return {Bucket:this.env.R2_BUCKET,Key:v.object_key};}
 async initiate(v:Version){return (await this.client.send(new CreateMultipartUploadCommand({...this.input(v),ContentType:'application/pdf'}))).UploadId!;}
 async signPart(v:Version,part:number,digest:string){
  const size=partSize(v.declared_bytes,part);
  const url=await getSignedUrl(this.client,new UploadPartCommand({...this.input(v),UploadId:v.upload!.multipart_id!,PartNumber:part,ContentMD5:digest,ContentLength:size}),{expiresIn:600,signableHeaders:new Set(['content-length','content-md5'])});
  return {url,bytes:size,expiresIn:600,headers:{'Content-MD5':digest}};
 }
 async parts(v:Version){
  if(!v.upload?.multipart_id)return [];
  const r=await this.client.send(new ListPartsCommand({...this.input(v),UploadId:v.upload.multipart_id,MaxParts:100}));
  if(r.IsTruncated)throw new Error('INVALID_PARTS');
  return (r.Parts??[]).map(p=>({part:p.PartNumber!,bytes:p.Size!,etag:p.ETag!}));
 }
 async head(v:Version){try{return await this.client.send(new HeadObjectCommand(this.input(v)));}catch(e){if((e as {$metadata?:{httpStatusCode:number}}).$metadata?.httpStatusCode===404)return null;throw e;}}
 async complete(v:Version){
  let head=await this.head(v);
  if(!head){
   const parts=await this.parts(v);
   if(parts.length!==Math.ceil(v.declared_bytes/PART_BYTES)||parts.some((p,i)=>p.part!==i+1||p.bytes!==partSize(v.declared_bytes,p.part)))throw new Error('INCOMPLETE_UPLOAD');
   await this.client.send(new CompleteMultipartUploadCommand({...this.input(v),UploadId:v.upload!.multipart_id!,MultipartUpload:{Parts:parts.map(p=>({PartNumber:p.part,ETag:p.etag}))}}));
   head=await this.head(v);
  }
  if(head?.ContentLength!==v.declared_bytes||head.ContentType!=='application/pdf')throw new Error('SIZE_MISMATCH');
  return head.ContentLength;
 }
 async abort(v:Version){if(v.upload?.multipart_id)try{await this.client.send(new AbortMultipartUploadCommand({...this.input(v),UploadId:v.upload.multipart_id}));}catch(e){if((e as {$metadata?:{httpStatusCode:number}}).$metadata?.httpStatusCode!==404)throw e;}}
 async download(v:Version,seconds=60){return getSignedUrl(this.client,new GetObjectCommand({...this.input(v),ResponseContentDisposition:'attachment; filename="tender.pdf"'}),{expiresIn:seconds});}
 async put(key:string,data:Uint8Array|string,type:string){await this.client.send(new PutObjectCommand({Bucket:this.env.R2_BUCKET,Key:key,Body:data,ContentType:type}));}
 async removeSource(v:Version){await this.client.send(new DeleteObjectCommand(this.input(v)));}
 async removeDerived(v:Version){
  const prefix=`derived/${v.organisation_id}/${v.project_id}/${v.document_id}/${v.id}/`;
  let continuation:string|undefined;
  do{const r=await this.client.send(new ListObjectsV2Command({Bucket:this.env.R2_BUCKET,Prefix:prefix,ContinuationToken:continuation,MaxKeys:200}));for(const o of r.Contents??[])if(o.Key)await this.client.send(new DeleteObjectCommand({Bucket:this.env.R2_BUCKET,Key:o.Key}));continuation=r.NextContinuationToken;}while(continuation);
 }
}
