/** Bounded private machine payloads; do not expose lead content or database errors. */
import { NextResponse } from 'next/server';
import { OperationError } from './operations';
export async function body(request:Request){
  if(request.headers.has('origin'))throw new OperationError('BROWSER_REQUEST_REFUSED',403);
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json'||!request.body)throw new OperationError('JSON_REQUIRED',415);
  const reader=request.body.getReader();const parts:Uint8Array[]=[];let size=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>262144){await reader.cancel();throw new OperationError('BODY_TOO_LARGE',413);}parts.push(chunk.value);}}finally{reader.releaseLock();}
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));
}
export function failure(error:unknown){return NextResponse.json({code:error instanceof OperationError?error.code:'STORAGE_UNAVAILABLE'},{status:error instanceof OperationError?error.status:503,headers:{'Cache-Control':'no-store'}});}
