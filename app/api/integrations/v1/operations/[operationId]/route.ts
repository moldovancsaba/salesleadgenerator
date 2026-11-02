/** Exact immutable result for a scoped key; no lookup retries a write. */
import { NextResponse } from 'next/server';
import { getClientPromise,isMongoConfigured } from '@/lib/mongodb';
import { authorize,operationLookup,OperationError } from '@/lib/integrations/operations';
import { failure } from '@/lib/integrations/http';
export async function GET(request:Request,context:{params:Promise<{operationId:string}>}){try{
  if(!isMongoConfigured())throw new OperationError('STORAGE_UNAVAILABLE',503);const brand=new URL(request.url).searchParams.get('brand');if(!brand||!['cogmap','seyu','dvsc'].includes(brand))throw new OperationError('WORKSPACE_REQUIRED',422);
  const db=(await getClientPromise()).db();const principal=await authorize(db,request,brand,false);const {operationId}=await context.params;return NextResponse.json(await operationLookup(db,principal,operationId,brand),{headers:{'Cache-Control':'no-store'}});
}catch(error){return failure(error);}}
