/** Initial owner commissioning is separate from ordinary scoped writer authentication. */
import { createHash,timingSafeEqual } from 'node:crypto';
import type { Db,MongoClient,Document } from 'mongodb';
import { CORE_FIELDS,OperationError } from './operations';
import { evaluateScopedKeyAuth,type ApiKeyRecord } from '../scoped-api-keys';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const RECEIPTS='integration_authority_operations';
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function text(value:unknown,max:number):value is string{return typeof value==='string'&&value.length>0&&value.length<=max;}
export function ownerAuthorization(request:Request,env:Record<string,string|undefined>=process.env){
 if(request.headers.has('origin'))throw new OperationError('BROWSER_REQUEST_REFUSED',403);
 const secret=env.SLG_AUTHORITY_PROVISIONING_TOKEN||'',allowed=(env.SLG_AUTHORITY_MANIFEST_SHA256||'').split(',').map(value=>value.trim());
 if(!SHA.test(secret)||!allowed.length||allowed.length>3||allowed.some(value=>!SHA.test(value))||new Set(allowed).size!==allowed.length)throw new OperationError('AUTHORITY_CHANNEL_DISABLED',503);
 const supplied=request.headers.get('authorization')||'';
 if(supplied.length>512||!timingSafeEqual(Buffer.from(digest(supplied)),Buffer.from(digest('Bearer '+secret))))throw new OperationError('UNAUTHORIZED',401);
 return new Set(allowed);
}
export type Commission={id:string;manifestSha256:string;requestHash:string;reviewRef:string;principal:string;clientId:string;tenantId:string;fields:string[];release:string};
export function parseCommission(raw:string,request:Request,allowed:Set<string>):Commission{
 let input:unknown;try{input=JSON.parse(raw);}catch{throw new OperationError('INVALID_AUTHORITY_REQUEST',422);}
 if(!object(input)||Object.keys(input).some(key=>!['provisioningId','manifestBase64','reviewRef'].includes(key))||!text(input.provisioningId,36)||!UUID.test(input.provisioningId)||!text(input.reviewRef,512)||!text(input.manifestBase64,180000))throw new OperationError('INVALID_AUTHORITY_REQUEST',422);
 if(request.headers.get('idempotency-key')!==input.provisioningId)throw new OperationError('IDEMPOTENCY_KEY_MISMATCH',409);
 const bytes=Buffer.from(input.manifestBase64,'base64');if(bytes.toString('base64')!==input.manifestBase64)throw new OperationError('INVALID_MANIFEST',422);
 const hash=digest(bytes);if(!allowed.has(hash))throw new OperationError('MANIFEST_NOT_REVIEWED',403);
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new OperationError('INVALID_MANIFEST',422);}
 if(!object(value)||value.version!==1||!object(value.scope)||value.scope.application!=='salesleadgenerator'||!['cogmap','seyu','dvsc'].includes(String(value.scope.client))||!object(value.principal)||!text(value.principal.id,128)||!object(value.grant)||!object(value.ownership)||!text(value.destination_commit,40)||!/^[a-f0-9]{40}$/.test(value.destination_commit))throw new OperationError('INVALID_MANIFEST',422);
 const grant=value.grant,owner=value.ownership,principal=value.principal.id,clientId=String(value.scope.client);
 if(grant.collection!=='integration_writer_grants'||grant.key!==principal||!Array.isArray(grant.clients)||grant.clients.length!==1||grant.clients[0]!==clientId||!Array.isArray(grant.tenants)||grant.tenants.length!==1||!text(grant.tenants[0],80)||!Array.isArray(grant.fields)||!grant.fields.length||grant.fields.length>CORE_FIELDS.size||grant.fields.some(field=>typeof field!=='string'||!CORE_FIELDS.has(field))||new Set(grant.fields).size!==grant.fields.length||owner.collection!=='integration_ownership'||owner.key!==clientId+':'+grant.tenants[0]||owner.writer!==principal||owner.initial_epoch_if_absent!==1||owner.legacyFenced!==true)throw new OperationError('INVALID_MANIFEST',422);
 return {id:input.provisioningId,manifestSha256:hash,requestHash:digest(raw),reviewRef:input.reviewRef,principal,clientId,tenantId:grant.tenants[0],fields:[...grant.fields].sort(),release:value.destination_commit};
}
export function receiptCoordinates(url:string,allowed:Set<string>){
 const params=new URL(url).searchParams,id=params.get('provisioningId')||'',hash=params.get('manifestSha256')||'';
 if([...params.keys()].some(key=>!['provisioningId','manifestSha256'].includes(key))||params.getAll('provisioningId').length!==1||params.getAll('manifestSha256').length!==1||!UUID.test(id)||!SHA.test(hash))throw new OperationError('INVALID_AUTHORITY_REQUEST',422);
 if(!allowed.has(hash))throw new OperationError('MANIFEST_NOT_REVIEWED',403);return {id,hash};
}
function exactAuthority(grant:Document|null,owner:Document|null,op:Commission){
 return grant?.active===true&&owner?.active===true&&owner.writer===op.principal&&owner.epoch===1&&owner.legacyFenced===true&&[grant,owner].every(row=>row.provisioningId===op.id&&row.manifestSha256===op.manifestSha256&&row.reviewRef===op.reviewRef)&&JSON.stringify(grant.clients)===JSON.stringify([op.clientId])&&JSON.stringify(grant.tenants)===JSON.stringify([op.tenantId])&&Array.isArray(grant.fields)&&JSON.stringify([...grant.fields].sort())===JSON.stringify(op.fields);
}
export async function commissionAuthority(db:Db,client:MongoClient,op:Commission,release:string|undefined=process.env.VERCEL_GIT_COMMIT_SHA){
 const session=client.startSession();
 try{return await session.withTransaction(async()=>{
  const receipts=db.collection(RECEIPTS),grants=db.collection('integration_writer_grants'),owners=db.collection('integration_ownership');
  const prior=await receipts.findOne({_id:op.id} as never,{session}),grant=await grants.findOne({_id:op.principal} as never,{session}),owner=await owners.findOne({_id:op.clientId+':'+op.tenantId} as never,{session});
  const key=await db.collection('api_keys').findOneAndUpdate({id:op.principal,brand:op.clientId,revokedAt:null,scopes:'read-write'},{$inc:{authoritySequence:1}},{session,returnDocument:'after'});
  if(!key||!evaluateScopedKeyAuth(key as unknown as ApiKeyRecord,op.clientId,'read-write').authorized)throw new OperationError('WRITER_KEY_REFUSED',403);
  if(prior){if(prior.requestHash!==op.requestHash||prior.manifestSha256!==op.manifestSha256)throw new OperationError('IDEMPOTENCY_BODY_MISMATCH',409);if(!exactAuthority(grant,owner,op))throw new OperationError('AUTHORITY_RECOVERY_REQUIRED',409);return prior.result;}
  if(release!==op.release)throw new OperationError('DESTINATION_RELEASE_CHANGED',409);
  if(grant||owner||await db.collection('integration_operations').findOne({clientId:op.clientId,tenantId:op.tenantId},{session})||await db.collection('integration_identities').findOne({},{session}))throw new OperationError('INITIAL_AUTHORITY_NOT_ABSENT',409);
  const common={active:true,reviewRef:op.reviewRef,provisioningId:op.id,manifestSha256:op.manifestSha256,operationSequence:0};
  await grants.insertOne({_id:op.principal,clients:[op.clientId],tenants:[op.tenantId],fields:op.fields,...common} as never,{session});
  await owners.insertOne({_id:op.clientId+':'+op.tenantId,writer:op.principal,epoch:1,legacyFenced:true,...common} as never,{session});
  const result={provisioningId:op.id,manifestSha256:op.manifestSha256,state:'authority-installed',clientId:op.clientId,tenantId:op.tenantId,writerEpoch:1,legacyFenced:true,customerRecordsMutated:0};
  await receipts.insertOne({_id:op.id,requestHash:op.requestHash,manifestSha256:op.manifestSha256,reviewRef:op.reviewRef,actorKind:'owner-operator-secret',principal:op.principal,fields:op.fields,createdAt:new Date(),result} as never,{session});return result;
 },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},maxCommitTimeMS:5000,timeoutMS:20000});}finally{await session.endSession();}
}
export async function authorityReceipt(db:Db,id:string,manifestSha256:string){
 const receipt=await db.collection(RECEIPTS).findOne({_id:id,manifestSha256} as never);if(!receipt)throw new OperationError('AUTHORITY_RECEIPT_NOT_FOUND',404);
 const result=receipt.result,op={id,manifestSha256,principal:receipt.principal,clientId:result.clientId,tenantId:result.tenantId,fields:receipt.fields,reviewRef:receipt.reviewRef} as Commission;
 const grant=await db.collection('integration_writer_grants').findOne({_id:op.principal} as never),owner=await db.collection('integration_ownership').findOne({_id:op.clientId+':'+op.tenantId} as never),key=await db.collection<ApiKeyRecord>('api_keys').findOne({id:op.principal});
 return {...result,currentAuthority:exactAuthority(grant,owner,op)&&evaluateScopedKeyAuth(key,op.clientId,'read-write').authorized?'matches-initial-receipt':'changed-requires-recovery'};
}
