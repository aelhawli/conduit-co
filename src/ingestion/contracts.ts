import {z} from 'zod';
export const FILE_LIMIT=250_000_000, PROJECT_LIMIT=2_000_000_000, PART_BYTES=8*1024*1024;
export const STAGING_DB='https://kvujhszkrblaovnksafx.supabase.co';
export const STAGING_ORIGIN='https://conduit-ingestion-staging.pages.dev';
export const STAGING_API='https://conduit-ingestion-staging.letstalk-531.workers.dev';
export const uuid=z.uuid();
export const controlSchema=z.object({action:z.enum(['organisations','projects','create_project','project','reserve','resume','version','part','complete','cancel','delete_project','download']),data:z.record(z.string(),z.unknown()).default({})}).strict();
export const reserveSchema=z.object({project_id:uuid,document_id:uuid.optional(),filename:z.string().min(1).max(240).regex(/\.pdf$/i),media_type:z.literal('application/pdf'),byte_size:z.number().int().min(1).max(FILE_LIMIT),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),idempotency_key:uuid,turnstileToken:z.string().min(1).max(2048)}).strict();
export const versionSchema=z.object({project_id:uuid,version_id:uuid}).strict();
export const partSchema=versionSchema.extend({part:z.number().int().min(1).max(Math.ceil(FILE_LIMIT/PART_BYTES)),digest:z.string().regex(/^[A-Za-z0-9+/]{22}==$/)});
export type Version={id:string;organisation_id:string;project_id:string;document_id:string;object_key:string;declared_bytes:number;state:string;source_deleted_at:string|null;delete_requested_at:string|null;page_count:number|null;upload?:{multipart_id:string|null;state:string;part_digests:Record<string,string>;expires_at:string}};
export type Job={id:string;version_id:string;lease_token:string;attempt:number;source:Version};
export function partSize(bytes:number,part:number){if(!Number.isInteger(part)||part<1||part>Math.ceil(bytes/PART_BYTES))throw new Error('INVALID_PART');return Math.min(PART_BYTES,bytes-(part-1)*PART_BYTES);}
