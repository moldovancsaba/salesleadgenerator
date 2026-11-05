/** Authenticated read-only workspace inspection; legacy global keys cannot use this route. */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getClientPromise,isMongoConfigured } from '@/lib/mongodb';
import { authorize,OperationError } from '@/lib/integrations/operations';
import { integrationCapabilities } from '@/lib/integrations/capabilities';
import { failure } from '@/lib/integrations/http';

export async function GET(request:Request){
  try{
    if(request.headers.has('origin'))throw new OperationError('BROWSER_REQUEST_REFUSED',403);
    const query=new URL(request.url).searchParams;
    const parsed=z.object({clientId:z.enum(['cogmap','seyu','dvsc']),tenantId:z.string().min(1).max(80)}).strict().safeParse(Object.fromEntries(query));
    if(!parsed.success||[...query.keys()].length!==2)throw new OperationError('INVALID_SCOPE',422);
    if(!isMongoConfigured())throw new OperationError('STORAGE_UNAVAILABLE',503);
    const client=await getClientPromise();const db=client.db();
    const principal=await authorize(db,request,parsed.data.clientId,false);
    return NextResponse.json(await integrationCapabilities(db,principal,parsed.data.clientId,parsed.data.tenantId),{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return failure(error);}
}
