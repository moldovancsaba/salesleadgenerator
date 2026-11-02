/** Exact workspace and tenant readback, including persisted private contact provenance. */
import { NextResponse } from 'next/server';
import { getClientPromise,isMongoConfigured } from '@/lib/mongodb';
import { getBrandConfig } from '@/app/lib/brand';
import { authorize,lookup,OperationError } from '@/lib/integrations/operations';
import { body,failure } from '@/lib/integrations/http';
export async function POST(request:Request){try{
  if(!isMongoConfigured())throw new OperationError('STORAGE_UNAVAILABLE',503);const input:unknown=JSON.parse(await body(request));if(!input||typeof input!=='object'||!('clientId' in input)||typeof input.clientId!=='string'||!['cogmap','seyu','dvsc'].includes(input.clientId))throw new OperationError('WORKSPACE_REQUIRED',422);
  const db=(await getClientPromise()).db();const principal=await authorize(db,request,input.clientId,false);const config=await getBrandConfig(input.clientId);if(!config)throw new OperationError('WRONG_WORKSPACE',403);
  return NextResponse.json(await lookup(db,principal,input,config),{headers:{'Cache-Control':'no-store'}});
}catch(error){return failure(error);}}
