/** Default-off owner commissioning; no business records are accessed. */
import { NextResponse } from 'next/server';
import { ownerAuthorization,parseCommission,receiptCoordinates,commissionAuthority,authorityReceipt } from '@/lib/integrations/authority';
import { body,failure } from '@/lib/integrations/http';
import { OperationError } from '@/lib/integrations/operations';
const headers={'Cache-Control':'no-store'};
async function storage(){const {isMongoConfigured,getClientPromise}=await import('@/lib/mongodb');if(!isMongoConfigured())throw new OperationError('STORAGE_UNAVAILABLE',503);return getClientPromise();}
export async function POST(request:Request){try{
 const allowed=ownerAuthorization(request),op=parseCommission(await body(request),request,allowed),client=await storage();
 return NextResponse.json(await commissionAuthority(client.db(),client,op),{headers});
}catch(error){return failure(error);}}
export async function GET(request:Request){try{
 const allowed=ownerAuthorization(request),{id,hash}=receiptCoordinates(request.url,allowed),client=await storage();
 return NextResponse.json(await authorityReceipt(client.db(),id,hash),{headers});
}catch(error){return failure(error);}}
