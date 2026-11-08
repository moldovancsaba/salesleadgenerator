import { afterEach,describe,it,expect,vi } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import { ownerAuthorization,parseCommission,receiptCoordinates } from '@/lib/integrations/authority';
const token='a'.repeat(64);
function fixture(){return {id:randomUUID(),manifest:{version:1,scope:{application:'salesleadgenerator',client:'seyu'},destination_commit:'b'.repeat(40),principal:{id:'writer-key'},grant:{collection:'integration_writer_grants',key:'writer-key',clients:['seyu'],tenants:['default'],fields:['address','contacts']},ownership:{collection:'integration_ownership',key:'seyu:default',writer:'writer-key',initial_epoch_if_absent:1,legacyFenced:true}}};}
function request(value:ReturnType<typeof fixture>){
 const bytes=Buffer.from(JSON.stringify(value.manifest)),sha=createHash('sha256').update(bytes).digest('hex'),raw=JSON.stringify({provisioningId:value.id,manifestBase64:bytes.toString('base64'),reviewRef:'independent-owner-review'});
 return {sha,raw,req:new Request('https://example.test/api/integrations/v1/authority',{headers:{authorization:'Bearer '+token,'idempotency-key':value.id}})};
}
describe('initial owner authority',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('defaults off and requires separate owner authentication',()=>{
  const {req,sha}=request(fixture());expect(()=>ownerAuthorization(req,{})).toThrow('AUTHORITY_CHANNEL_DISABLED');
  const env={SLG_AUTHORITY_PROVISIONING_TOKEN:token,SLG_AUTHORITY_MANIFEST_SHA256:sha};expect(ownerAuthorization(req,env)).toEqual(new Set([sha]));
  for(const headers of [{'x-api-key':'slg_writer'},{authorization:'Bearer slg_writer'},{authorization:'Bearer '+token+'x'}] as Record<string,string>[])expect(()=>ownerAuthorization(new Request('https://example.test',{headers}),env)).toThrow('UNAUTHORIZED');
  expect(()=>ownerAuthorization(new Request('https://example.test',{headers:{origin:'https://example.test',authorization:'Bearer '+token}}),env)).toThrow('BROWSER_REQUEST_REFUSED');
 });
 it('refuses malformed or duplicate digest configuration',()=>{
  const {req,sha}=request(fixture());for(const value of ['',sha+','+sha,'invalid'])expect(()=>ownerAuthorization(req,{SLG_AUTHORITY_PROVISIONING_TOKEN:token,SLG_AUTHORITY_MANIFEST_SHA256:value})).toThrow('AUTHORITY_CHANNEL_DISABLED');
 });
 it('binds exact manifest and original request bytes with explicit workspace and tenant',()=>{
  const value=fixture(),{req,sha,raw}=request(value),op=parseCommission(raw,req,new Set([sha]));expect(op).toMatchObject({id:value.id,manifestSha256:sha,clientId:'seyu',tenantId:'default',fields:['address','contacts']});
  expect(parseCommission(raw+' ',req,new Set([sha])).requestHash).not.toBe(op.requestHash);
 });
 it('refuses an unreviewed manifest, changed identity and malformed JSON',()=>{
  const {req,sha,raw}=request(fixture());expect(()=>parseCommission(raw,req,new Set(['c'.repeat(64)]))).toThrow('MANIFEST_NOT_REVIEWED');expect(()=>parseCommission(raw,new Request('https://example.test'),new Set([sha]))).toThrow('IDEMPOTENCY_KEY_MISMATCH');
  for(const value of ['invalid','[]','{}'])expect(()=>parseCommission(value,req,new Set([sha]))).toThrow('INVALID_AUTHORITY_REQUEST');
 });
 it.each(['workspace','tenant','field','epoch','fence','collection','principal','release'])('refuses invalid %s even with a matching digest',change=>{
  const value=fixture();if(change==='workspace')value.manifest.grant.clients.push('cogmap');if(change==='tenant')value.manifest.grant.tenants.push('other');if(change==='field')value.manifest.grant.fields.push('kanbanColumn');if(change==='epoch')value.manifest.ownership.initial_epoch_if_absent=2;if(change==='fence')value.manifest.ownership.legacyFenced=false;if(change==='collection')value.manifest.ownership.collection='seyu_leads';if(change==='principal')value.manifest.ownership.writer='another-key';if(change==='release')value.manifest.destination_commit='short';
  const {req,sha,raw}=request(value);expect(()=>parseCommission(raw,req,new Set([sha]))).toThrow('INVALID_MANIFEST');
 });
 it('validates receipt coordinates before opening storage',()=>{
  const value=fixture(),{sha}=request(value),url='https://example.test?provisioningId='+value.id+'&manifestSha256='+sha;
  expect(receiptCoordinates(url,new Set([sha]))).toEqual({id:value.id,hash:sha});
  for(const bad of [url+'&provisioningId='+value.id,url+'&extra=value','https://example.test?provisioningId=bad'])expect(()=>receiptCoordinates(bad,new Set([sha]))).toThrow('INVALID_AUTHORITY_REQUEST');
 });
});
