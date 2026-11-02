/** Private workspace-scoped operations; only revocable scoped API keys and explicit grants are accepted. */
import { NextResponse } from 'next/server';
import { getClientPromise,isMongoConfigured } from '@/lib/mongodb';
import { getBrandConfig,getForbiddenTermsFor } from '@/app/lib/brand';
import { parseOperation,authorize,executeOperation,OperationError } from '@/lib/integrations/operations';
import { body,failure } from '@/lib/integrations/http';
export async function POST(request:Request){try{
  if(!isMongoConfigured())throw new OperationError('STORAGE_UNAVAILABLE',503);
  const raw=await body(request);const op=parseOperation(JSON.parse(raw));if(request.headers.get('Idempotency-Key')!==op.operationId)throw new OperationError('IDEMPOTENCY_KEY_MISMATCH',409);
  const client=await getClientPromise();const db=client.db();const principal=await authorize(db,request,op.clientId,true);const config=await getBrandConfig(op.clientId);if(!config)throw new OperationError('WRONG_WORKSPACE',403);
  const result=await executeOperation(db,client,principal,op,raw,config,await getForbiddenTermsFor(op.clientId));return NextResponse.json(result,{status:result.statusCode,headers:{'Cache-Control':'no-store'}});
}catch(error){return failure(error);}}
