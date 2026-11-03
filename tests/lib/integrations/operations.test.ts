import { describe,it,expect,vi } from 'vitest';
import { executeOperation,parseOperation,revision,withProvenance } from '../../../lib/integrations/operations';
import type { Db,MongoClient } from 'mongodb';
const base={operationId:'00000000-0000-4000-8000-000000000001',clientId:'seyu',tenantId:'default',writerEpoch:1,action:'update',entityType:'lead',targetId:'test',expectedRevision:'a'.repeat(64),patch:{address:'1 Main Street'},evidence:[{field:'address',sourceUrl:'https://example.test/contact',observedAt:'2026-11-02T10:00:00Z',method:'official'}]};
describe('scoped lead operations',()=>{
 it('holds a superseded writer epoch before reading or changing a lead',async()=>{
  const touched:string[]=[];const ownership=vi.fn(async()=>null);
  const session={withTransaction:async(callback:()=>Promise<unknown>)=>callback(),endSession:vi.fn(async()=>undefined)};
  const db={collection:(name:string)=>{touched.push(name);return {
   findOne:async()=>null,
   findOneAndUpdate:name==='integration_ownership'?ownership:async()=>({reviewRef:'fixture-review',clients:['seyu'],tenants:['default'],fields:['address']})
  };}} as unknown as Db;
  const client={startSession:()=>session} as unknown as MongoClient;
  const operation=parseOperation(base);
  await expect(executeOperation(db,client,'machine',operation,JSON.stringify(base),{dbCollection:'fixture_leads'} as never,[])).rejects.toThrow('WRITER_EPOCH_REFUSED');
  expect(ownership).toHaveBeenCalledWith(expect.objectContaining({writer:'machine',epoch:1}),{$inc:{operationSequence:1}},expect.objectContaining({session}));
  expect(touched).not.toContain('fixture_leads');expect(session.endSession).toHaveBeenCalledOnce();
 });
 it('requires explicit workspace, tenant and revision',()=>{
  expect(parseOperation(base).clientId).toBe('seyu');
  for(const override of [{clientId:'unknown'},{tenantId:''},{expectedRevision:null},{patch:{tenantId:'other'}},{extra:true}])expect(()=>parseOperation({...base,...override})).toThrow();
 });
 it('preserves real Date revisions and ignores working timestamps',()=>{
  expect(revision({name:'Example',updatedAt:new Date(1)})).toBe(revision({name:'Example',updatedAt:new Date(2)}));
  expect(revision({observed:new Date(1)})).not.toBe(revision({observed:new Date(2)}));
 });
 it('persists independently sourced top-level provenance',()=>{
  const next=withProvenance(base.patch,base.evidence,'integration-test');
  expect(next.fieldVerifications).toMatchObject([{field:'address',method:'official',sourceUrl:'https://example.test/contact',verifiedBy:'integration-test'}]);
  expect(()=>withProvenance(base.patch,[],'integration-test')).toThrow('FIELD_EVIDENCE_REQUIRED');
 });
 it('binds contact provenance to a stable contact identity rather than an array index',()=>{
  const contact={name:'Alex Example',email:'alex@example.test'};
  expect(()=>withProvenance({contacts:[contact]},[],'integration-test')).toThrow('CONTACT_FIELD_EVIDENCE_REQUIRED');
  const result=withProvenance({contacts:[contact]},[{field:'email',contactKey:'alex example|alex@example.test',sourceUrl:'https://example.test/team',observedAt:'2026-11-02T10:00:00Z',method:'official'}],'integration-test');
  expect(result.contacts).toMatchObject([{fieldVerifications:[{field:'email',sourceUrl:'https://example.test/team'}]}]);
  expect(()=>withProvenance({contacts:[contact]},[{...base.evidence[0],field:'email',contactKey:'0'}],'integration-test')).toThrow('CONTACT_EVIDENCE_MISMATCH');
 });
 it('refuses fabricated admin verification or contact evidence in the lead array',()=>{
  expect(()=>withProvenance(base.patch,[{...base.evidence[0],method:'admin'}],'integration-test')).toThrow('INVALID_EVIDENCE_METHOD');
  expect(()=>withProvenance({contacts:[]},[{...base.evidence[0],field:'contacts'}],'integration-test')).toThrow('EVIDENCE_FIELD_MISMATCH');
 });
 it('permits generated descriptions but never generated contact facts',()=>{
  const evidence={...base.evidence[0],field:'value_proposition',method:'ai_generated'};
  expect(withProvenance({value_proposition:'Sourced description'},[evidence],'machine')).toMatchObject({fieldVerifications:[{method:'ai_generated',verifiedBy:'machine'}]});
  expect(()=>withProvenance(base.patch,[{...evidence,field:'address'}],'machine')).toThrow('INVALID_EVIDENCE_METHOD');
  expect(()=>withProvenance({contacts:[]},[{...evidence,contactKey:'fixture'}],'machine')).toThrow('INVALID_EVIDENCE_METHOD');
 });
 it('ignores submitted verification metadata when checking new contact facts',()=>{
  const forged={name:'Alex Example',email:'alex@example.test',fieldVerifications:[{field:'email',sourceUrl:'https://example.test',method:'admin',verifiedAt:base.evidence[0].observedAt}]};
  expect(()=>withProvenance({contacts:[forged]},[],'machine')).toThrow('CONTACT_FIELD_EVIDENCE_REQUIRED');
 });
});
