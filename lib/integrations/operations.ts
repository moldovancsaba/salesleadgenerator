/** Revocable workspace-scoped lead operations and provenance; private leads never imply publication. */
import { createHash } from 'node:crypto';
import { ObjectId, type Db, type Document, type MongoClient } from 'mongodb';
import { evaluateScopedKeyAuth, hashApiKey, type ApiKeyRecord } from '../scoped-api-keys';
import { MANUAL_LEAD_DEFAULT_ICE } from '../create-lead-defaults';
import { validateLeadPayload } from '../validate-lead';
import { normalizeLead } from '@/app/lib/normalize-lead';
import { normalizeFieldVerifications, type FieldVerification } from '../field-verifications';
import { dedupeContacts, deriveContactEmails, contactKey } from '../contacts';
import { tenantFilter } from '../tenant';
import { generateClassificationTags, buildMergeKey } from '../lead-classification';
import type { BrandConfig } from '@/app/lib/brand-constants';

export class OperationError extends Error { constructor(public code: string,public status: number){super(code);} }
export type Evidence = {field:string;sourceUrl:string;observedAt:string;method:string;contactKey?:string};
export type Operation = {operationId:string;clientId:string;tenantId:string;writerEpoch:number;action:'create'|'update';entityType:'lead';targetId:string;expectedRevision:string|null;patch:Record<string,unknown>;evidence:Evidence[]};
export const CORE_FIELDS: ReadonlySet<string> = new Set(['entity_name','url','region','country','address','general_contact','size','industry','sport_or_sector','level_league','value_proposition','notes','tags','contacts','sportCode','orgTypeCode','businessUnitCode','genderCode','demographicCodes','competitionLevelCode','cityName','parentOrgId','relationship','classificationConfidence','classificationEvidence']);
const COLLECTIONS={grants:'integration_writer_grants',ownership:'integration_ownership',operations:'integration_operations',identities:'integration_identities'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
function stable(value:unknown):unknown{
  if(value instanceof Date)return value.toISOString();
  if(value instanceof ObjectId)return value.toHexString();
  if(Array.isArray(value))return value.map(stable);
  if(object(value))return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
export function revision(row:Record<string,unknown>){return createHash('sha256').update(JSON.stringify(stable(Object.fromEntries(Object.entries(row).filter(([k])=>!['_id','updatedAt','lastVerifiedAt'].includes(k)))))).digest('hex');}
export function parseOperation(input:unknown):Operation{
  if(!object(input)||Object.keys(input).some(k=>!['operationId','clientId','tenantId','writerEpoch','action','entityType','targetId','expectedRevision','patch','evidence'].includes(k)))throw new OperationError('INVALID_OPERATION',422);
  const v=input;
  if(typeof v.operationId!=='string'||!UUID.test(v.operationId)||!['cogmap','seyu','dvsc'].includes(String(v.clientId))||typeof v.tenantId!=='string'||!v.tenantId||v.tenantId.length>80||!Number.isInteger(v.writerEpoch)||Number(v.writerEpoch)<1||!['create','update'].includes(String(v.action))||v.entityType!=='lead'||typeof v.targetId!=='string'||!v.targetId||v.targetId.length>160||!object(v.patch)||Object.keys(v.patch).length>100||Object.keys(v.patch).some(k=>!CORE_FIELDS.has(k))||!Array.isArray(v.evidence)||v.evidence.length>100)throw new OperationError('INVALID_OPERATION',422);
  if(v.action==='create'?v.expectedRevision!==null:typeof v.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedRevision))throw new OperationError('REVISION_REQUIRED',422);
  for(const evidence of v.evidence){
    if(!object(evidence)||Object.keys(evidence).some(k=>!['field','sourceUrl','observedAt','method','contactKey'].includes(k))||typeof evidence.field!=='string'||evidence.field.length>100||typeof evidence.sourceUrl!=='string'||evidence.sourceUrl.length>2048||typeof evidence.observedAt!=='string'||!Number.isFinite(Date.parse(evidence.observedAt))||typeof evidence.method!=='string'||evidence.method.length>80||evidence.contactKey!==undefined&&(typeof evidence.contactKey!=='string'||evidence.contactKey.length>300))throw new OperationError('INVALID_EVIDENCE',422);
    let source:URL;try{source=new URL(evidence.sourceUrl);}catch{throw new OperationError('INVALID_EVIDENCE',422);}
    if(source.protocol!=='https:'||source.username||source.password)throw new OperationError('INVALID_EVIDENCE',422);
  }
  return v as Operation;
}
export async function authorize(db:Db,request:Request,brand:string,write:boolean){
  if(request.headers.has('origin'))throw new OperationError('BROWSER_REQUEST_REFUSED',403);
  const key=request.headers.get('x-api-key');if(!key||key.length>512)throw new OperationError('UNAUTHORIZED',401);
  const row=await db.collection<ApiKeyRecord>('api_keys').findOne({hashedKey:hashApiKey(key)});
  if(!evaluateScopedKeyAuth(row,brand,write?'read-write':'read').authorized||!row)throw new OperationError('UNAUTHORIZED',401);
  return row.id;
}
async function grant(db:Db,principal:string,brand:string,tenant:string,session?:import('mongodb').ClientSession){
  const grants=db.collection(COLLECTIONS.grants);
  const row=session
    ? await grants.findOneAndUpdate({_id:principal,active:true} as never,{$inc:{operationSequence:1}},{session,returnDocument:'after'})
    : await grants.findOne({_id:principal,active:true} as never);
  if(!row||!row.reviewRef||!Array.isArray(row.clients)||!row.clients.includes(brand)||!Array.isArray(row.tenants)||!row.tenants.includes(tenant))throw new OperationError('WRONG_WORKSPACE',403);
  return row;
}
function idFilter(target:string,tenant:string){
  const ids:Document[]=[{id:target}];if(ObjectId.isValid(target))ids.push({_id:new ObjectId(target)});
  return {$and:[tenantFilter(tenant),{$or:ids}]};
}
export function withProvenance(patch:Record<string,unknown>,evidence:Evidence[],principal:string,current:Record<string,unknown>={}){
  const result={...patch};const top:FieldVerification[]=[];
  const original=Array.isArray(current.contacts)?dedupeContacts(current.contacts):[];
  const contacts=Array.isArray(patch.contacts)?dedupeContacts(patch.contacts).map(contact=>{
    const prior=original.find(c=>contactKey(c)===contactKey(contact));
    return {...contact,fieldVerifications:prior?.fieldVerifications||[]};
  }):null;
  for(const e of evidence){
    if(!['official','official_social','public','registration_system'].includes(e.method)&&!(e.method==='ai_generated'&&e.field==='value_proposition'&&!e.contactKey))throw new OperationError('INVALID_EVIDENCE_METHOD',422);
    const normalized=normalizeFieldVerifications([{field:e.field,sourceUrl:e.sourceUrl,verifiedAt:e.observedAt,method:e.method,verifiedBy:principal}]);
    if(normalized.length!==1)throw new OperationError('INVALID_EVIDENCE',422);
    if(e.contactKey){
      if(!contacts)throw new OperationError('CONTACT_EVIDENCE_WITHOUT_CONTACTS',422);
      const contact=contacts.find(c=>contactKey(c)===e.contactKey);
      if(!contact||!['email','phone','linkedin','title','role'].includes(e.field))throw new OperationError('CONTACT_EVIDENCE_MISMATCH',422);
      contact.fieldVerifications=normalizeFieldVerifications([...(contact.fieldVerifications||[]),...normalized]);
    }else{
      if(e.field==='contacts'||!(e.field in patch))throw new OperationError('EVIDENCE_FIELD_MISMATCH',422);
      top.push(...normalized);
    }
  }
  if(Object.keys(patch).some(field=>field!=='contacts'&&!top.some(e=>e.field===field)))throw new OperationError('FIELD_EVIDENCE_REQUIRED',422);
  if(contacts){
    for(const contact of contacts){
      const prior=original.find(c=>contactKey(c)===contactKey(contact));
      for(const field of ['email','phone','linkedin','title','role'] as const){
        if(contact[field] && (!prior || contact[field]!==prior[field]) && !contact.fieldVerifications?.some(v=>v.field===field&&Boolean(v.sourceUrl)))throw new OperationError('CONTACT_FIELD_EVIDENCE_REQUIRED',422);
      }
    }
  }
  if(top.length)result.fieldVerifications=normalizeFieldVerifications([...(Array.isArray(current.fieldVerifications)?current.fieldVerifications:[]),...top]);
  if(contacts){result.contacts=contacts;result.contactEmails=deriveContactEmails(contacts);}
  return result;
}
export async function executeOperation(db:Db,client:MongoClient,principal:string,op:Operation,raw:string,brand:BrandConfig,forbidden:string[]){
  const id=principal+':'+op.operationId;const hash=createHash('sha256').update(raw).digest('hex');const session=client.startSession();
  try{return await session.withTransaction(async()=>{
    const ledger=db.collection(COLLECTIONS.operations);const previous=await ledger.findOne({_id:id} as never,{session});
    if(previous){if(previous.hash!==hash)throw new OperationError('IDEMPOTENCY_BODY_MISMATCH',409);return previous.result;}
    const g=await grant(db,principal,op.clientId,op.tenantId,session);
    const ownership=await db.collection(COLLECTIONS.ownership).findOneAndUpdate(
      {_id:op.clientId+':'+op.tenantId,active:true,writer:principal,epoch:op.writerEpoch} as never,
      {$inc:{operationSequence:1}},{session,returnDocument:'after'});
    if(!ownership||!ownership.reviewRef||ownership.writer!==principal||ownership.epoch!==op.writerEpoch)throw new OperationError('WRITER_EPOCH_REFUSED',403);
    if(!Array.isArray(g.fields)||Object.keys(op.patch).some(k=>!g.fields.includes(k)))throw new OperationError('FIELD_SCOPE_REFUSED',403);
    const leads=db.collection(brand.dbCollection);const existing=await leads.findOne(idFilter(op.targetId,op.tenantId),{session});
    if(op.action==='create'&&existing||op.action==='update'&&!existing)throw new OperationError('IDENTITY_CONFLICT',409);
    if(existing&&revision(existing)!==op.expectedRevision)throw new OperationError('REVISION_CONFLICT',409);
    const payload=op.action==='create'?{...op.patch,ice:{...MANUAL_LEAD_DEFAULT_ICE},kanbanColumn:'DISCOVERED'}:op.patch;
    const validation=validateLeadPayload(payload,op.clientId,forbidden,{partial:op.action==='update'});if(!validation.valid)throw new OperationError('APPLICATION_VALIDATION_FAILED',422);
    const enriched=withProvenance(op.patch,op.evidence,principal,existing||{});
    const next:Record<string,unknown>=op.action==='create'?normalizeLead({...payload,...enriched}):{...existing,...enriched};
    const classification=generateClassificationTags(next as import('../lead-classification').ClassificationFields);Object.assign(next,{classificationTags:classification,mergeKey:buildMergeKey(next as import('../lead-classification').ClassificationFields)});
    const identity=createHash('sha256').update(JSON.stringify([op.clientId,op.tenantId,String(next.entity_name||'').trim().toLowerCase(),String(next.url||'').trim().toLowerCase()])).digest('hex');
    const reserved=await db.collection(COLLECTIONS.identities).findOne({_id:identity} as never,{session});
    if(reserved&&reserved.targetId!==op.targetId)throw new OperationError('IDENTITY_CONFLICT',409);
    await db.collection(COLLECTIONS.identities).updateOne({_id:identity} as never,{$setOnInsert:{targetId:op.targetId}},{upsert:true,session});
    let stored;
    if(op.action==='create'){
      const created={...next,id:op.targetId,tenantId:op.tenantId,createdAt:new Date(),updatedAt:new Date(),source:'source-exchange',fieldVerifications:enriched.fieldVerifications??[],contacts:enriched.contacts??next.contacts??[]};
      const inserted=await leads.insertOne(created,{session});stored={...created,_id:inserted.insertedId};
    }else{
      const fields=Object.fromEntries(Object.entries(next).filter(([k])=>k!=='_id'));
      await leads.updateOne({_id:existing!._id},{$set:{...fields,updatedAt:new Date()}},{session});stored=await leads.findOne({_id:existing!._id},{session});
    }
    if(!stored)throw new OperationError('EFFECT_NOT_STORED',503);
    const response={operationId:op.operationId,state:'applied',destinationId:stored._id.toString(),contentRevision:revision(stored),persistedFields:Object.keys(op.patch),publication:{kind:'private-lead',isPublished:false},statusCode:op.action==='create'?201:200};
    await ledger.insertOne({_id:id,principal,clientId:op.clientId,tenantId:op.tenantId,hash,result:response} as never,{session});return response;
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},maxCommitTimeMS:5000,timeoutMS:20000});}
  finally{await session.endSession();}
}
export async function operationLookup(db:Db,principal:string,id:string,brand:string){const row=await db.collection(COLLECTIONS.operations).findOne({_id:principal+':'+id,clientId:brand} as never);if(!row)throw new OperationError('NOT_FOUND',404);return {operationId:id,requestSha256:row.hash,...row.result};}
export async function lookup(db:Db,principal:string,input:unknown,brand:BrandConfig){
  if(!object(input)||typeof input.clientId!=='string'||typeof input.tenantId!=='string'||!Array.isArray(input.leadIds)||!input.leadIds.length||input.leadIds.length>100||!Array.isArray(input.fieldPaths)||input.fieldPaths.length>100||input.leadIds.some(v=>typeof v!=='string'||v.length>160)||input.fieldPaths.some(v=>typeof v!=='string'||!CORE_FIELDS.has(v)))throw new OperationError('INVALID_LOOKUP',422);
  const g=await grant(db,principal,input.clientId,input.tenantId);const fields=input.fieldPaths as string[];
  if(!Array.isArray(g.fields)||fields.some(f=>!g.fields.includes(f)))throw new OperationError('FIELD_SCOPE_REFUSED',403);
  const results=[];
  for(const id of input.leadIds as string[]){const row=await db.collection(brand.dbCollection).findOne(idFilter(id,input.tenantId));
    results.push(row?{requestedId:id,canonicalId:row._id.toString(),found:true,contentRevision:revision(row),fields:Object.fromEntries(fields.filter(f=>f in row).map(f=>[f,row[f]])),provenance:Array.isArray(row.fieldVerifications)?row.fieldVerifications.filter(v=>fields.includes(v.field)):[],missingFields:fields.filter(f=>!(f in row)),publication:{kind:'private-lead',isPublished:false}}:{requestedId:id,found:false});}
  if(Buffer.byteLength(JSON.stringify(results))>262144)throw new OperationError('LOOKUP_RESPONSE_TOO_LARGE',422);
  return {results};
}
