import {describe,it,expect,vi} from 'vitest';
import type {Db} from 'mongodb';
import {legacyMachineWriteResponse} from '../../../lib/integrations/legacy';
describe('legacy machine write fencing',()=>{
 it('refuses an activated workspace but does not block reads or the operation API',async()=>{
  const findOne=vi.fn(async()=>({active:true,legacyFenced:true}));const db={collection:()=>({findOne})} as unknown as Db;
  expect((await legacyMachineWriteResponse(db,new Request('https://example.test/api/leads/x?tenantId=one',{method:'PUT'}),'seyu'))?.status).toBe(409);
  expect(findOne).toHaveBeenCalledWith({_id:'seyu:one',active:true,legacyFenced:true});
  expect(await legacyMachineWriteResponse(db,new Request('https://example.test/api/leads'),'seyu')).toBeNull();
  expect(await legacyMachineWriteResponse(db,new Request('https://example.test/api/integrations/v1/operations',{method:'POST'}),'seyu')).toBeNull();
 });
});
