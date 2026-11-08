import { afterEach,describe,it,expect,vi } from 'vitest';
const storage=vi.hoisted(()=>({getClientPromise:vi.fn(),isMongoConfigured:vi.fn(()=>true)}));
vi.mock('@/lib/mongodb',()=>storage);
import { GET,POST } from '@/app/api/integrations/v1/authority/route';
describe('owner authority refusal before storage',()=>{
 afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
 it('keeps default-off requests away from storage',async()=>{
  vi.stubEnv('SLG_AUTHORITY_PROVISIONING_TOKEN','');vi.stubEnv('SLG_AUTHORITY_MANIFEST_SHA256','');
  expect((await GET(new Request('https://example.test'))).status).toBe(503);expect((await POST(new Request('https://example.test',{method:'POST'}))).status).toBe(503);expect(storage.getClientPromise).not.toHaveBeenCalled();
 });
 it('refuses scoped keys and browser requests before storage',async()=>{
  vi.stubEnv('SLG_AUTHORITY_PROVISIONING_TOKEN','a'.repeat(64));vi.stubEnv('SLG_AUTHORITY_MANIFEST_SHA256','b'.repeat(64));
  expect((await POST(new Request('https://example.test',{method:'POST',headers:{'x-api-key':'scoped-writer'}}))).status).toBe(401);
  expect((await GET(new Request('https://example.test',{headers:{origin:'https://example.test',authorization:'Bearer '+'a'.repeat(64)}}))).status).toBe(403);expect(storage.getClientPromise).not.toHaveBeenCalled();
 });
 it('refuses malformed receipt coordinates before storage',async()=>{
  vi.stubEnv('SLG_AUTHORITY_PROVISIONING_TOKEN','a'.repeat(64));vi.stubEnv('SLG_AUTHORITY_MANIFEST_SHA256','b'.repeat(64));
  expect((await GET(new Request('https://example.test?provisioningId=invalid',{headers:{authorization:'Bearer '+'a'.repeat(64)}}))).status).toBe(422);expect(storage.getClientPromise).not.toHaveBeenCalled();
 });
});
