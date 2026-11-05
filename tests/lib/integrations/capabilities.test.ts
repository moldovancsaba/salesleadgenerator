import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { Db } from 'mongodb';
import { integrationCapabilities } from '../../../lib/integrations/capabilities';
import { GET } from '../../../app/api/integrations/v1/capabilities/route';
import { getClientPromise,isMongoConfigured } from '../../../lib/mongodb';
import { authorize,OperationError } from '../../../lib/integrations/operations';

vi.mock('../../../lib/mongodb',()=>({getClientPromise:vi.fn(),isMongoConfigured:vi.fn()}));
vi.mock('../../../lib/integrations/operations',async(importOriginal)=>({...await importOriginal<typeof import('../../../lib/integrations/operations')>(),authorize:vi.fn()}));

function fixture(grant:Record<string,unknown>|null=null,owner:Record<string,unknown>|null=null){
  const touched:string[]=[];
  const db={collection:(name:string)=>{touched.push(name);return {findOne:async(_filter:unknown,options:{maxTimeMS:number})=>{expect(options.maxTimeMS).toBe(3000);return name==='integration_writer_grants'?grant:owner;}};},admin:()=>({command:async()=>({logicalSessionTimeoutMinutes:30,setName:'fixture'})})} as unknown as Db;
  return {db,touched};
}
describe('workspace integration capabilities',()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.mocked(isMongoConfigured).mockReturnValue(true);vi.mocked(authorize).mockResolvedValue('fixture-key-id');vi.mocked(getClientPromise).mockResolvedValue({db:()=>fixture().db} as never);});
  it('identifies its own key without revealing ownership in an ungranted tenant',async()=>{
    const f=fixture();const result=await integrationCapabilities(f.db,'fixture-key-id','cogmap','tenant-a');
    expect(result).toMatchObject({principalId:'fixture-key-id',writesAuthorized:false,ownership:{checked:false,present:null},customerRecordsRead:0,mutations:0});
    expect(f.touched).toEqual(['integration_writer_grants']);
  });
  it('requires exact brand and tenant plus reviewed ownership and filters unsafe field paths',async()=>{
    const grant={active:true,reviewRef:'fixture',clients:['cogmap'],tenants:['tenant-a'],fields:['entity_name','$unsafe','contacts.email']};const owner={active:true,writer:'fixture-key-id',epoch:1,reviewRef:'fixture',legacyFenced:true};
    expect(await integrationCapabilities(fixture(grant,owner).db,'fixture-key-id','cogmap','tenant-a')).toMatchObject({writesAuthorized:true,grant:{fields:['entity_name']},ownership:{checked:true,present:true}});
    for(const changed of [{...grant,tenants:['other']},{...grant,clients:['seyu']},{...grant,active:false}]){
      const f=fixture(changed,owner);expect((await integrationCapabilities(f.db,'fixture-key-id','cogmap','tenant-a')).writesAuthorized).toBe(false);expect(f.touched).toEqual(['integration_writer_grants']);
    }
    expect((await integrationCapabilities(fixture(grant,{...owner,writer:'other'}).db,'fixture-key-id','cogmap','tenant-a')).writesAuthorized).toBe(false);
  });
  it('uses read-only scoped-key authentication and disables caching',async()=>{
    const response=await GET(new Request('https://fixture.test/api/integrations/v1/capabilities?clientId=cogmap&tenantId=tenant-a',{headers:{'x-api-key':'fixture-only'}}));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(vi.mocked(authorize).mock.calls[0].slice(2)).toEqual(['cogmap',false]);
    expect(await response.json()).toMatchObject({scope:{clientId:'cogmap',tenantId:'tenant-a'},writesAuthorized:false});
  });
  it('rejects browser, missing tenant, duplicate and unknown parameters before database access',async()=>{
    for(const suffix of ['?clientId=cogmap','?clientId=unknown&tenantId=a','?clientId=cogmap&tenantId=a&tenantId=b','?clientId=cogmap&tenantId=a&extra=1'])expect((await GET(new Request('https://fixture.test/api/integrations/v1/capabilities'+suffix))).status).toBe(422);
    expect((await GET(new Request('https://fixture.test/api/integrations/v1/capabilities?clientId=cogmap&tenantId=a',{headers:{Origin:'https://fixture.test'}}))).status).toBe(403);expect(getClientPromise).not.toHaveBeenCalled();
  });
  it('returns explicit authorization and dependency failures without exposing secrets',async()=>{
    vi.mocked(authorize).mockRejectedValueOnce(new OperationError('UNAUTHORIZED',401));
    expect((await GET(new Request('https://fixture.test/api/integrations/v1/capabilities?clientId=cogmap&tenantId=a'))).status).toBe(401);
    vi.mocked(getClientPromise).mockRejectedValueOnce(new Error('private connection details'));
    const response=await GET(new Request('https://fixture.test/api/integrations/v1/capabilities?clientId=cogmap&tenantId=a'));expect(response.status).toBe(503);expect(await response.text()).not.toContain('private connection');
  });
});
