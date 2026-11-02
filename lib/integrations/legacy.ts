/** An activated destination-owned delegation fences older machine writes, while browser sessions stay separate. */
import type { Db } from 'mongodb';
import { NextResponse } from 'next/server';
import { getTenantId } from '../tenant';
export async function legacyMachineWriteResponse(db:Db,request:Request,brand:string):Promise<NextResponse|null>{
  if(['GET','HEAD'].includes(request.method)||new URL(request.url).pathname.startsWith('/api/integrations/'))return null;
  const tenant=getTenantId(request);
  const ownership=await db.collection('integration_ownership').findOne({_id:brand+':'+tenant,active:true,legacyFenced:true} as never);
  if(ownership?.active===true&&ownership.legacyFenced===true)return NextResponse.json({code:'SCOPED_OPERATION_REQUIRED'},{status:409});
  return null;
}
