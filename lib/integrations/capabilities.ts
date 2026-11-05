/** Workspace authority metadata without private lead data, key values or write reservations. */
import type { Db } from 'mongodb';

export async function integrationCapabilities(db:Db,principal:string,brand:string,tenantId:string){
  const options={maxTimeMS:3000};
  const [grant,hello]=await Promise.all([
    db.collection('integration_writer_grants').findOne({_id:principal} as never,{...options,projection:{active:1,clients:1,tenants:1,fields:1,reviewRef:1}}),
    db.admin().command({hello:1},{timeoutMS:3000}),
  ]);
  const scoped=grant?.active===true&&Boolean(grant.reviewRef)&&Array.isArray(grant.clients)&&grant.clients.includes(brand)&&Array.isArray(grant.tenants)&&grant.tenants.includes(tenantId);
  const ownership=scoped?await db.collection('integration_ownership').findOne({_id:brand+':'+tenantId} as never,{...options,projection:{active:1,writer:1,epoch:1,legacyFenced:1,reviewRef:1}}):null;
  const owned=ownership?.active===true&&Boolean(ownership.reviewRef)&&ownership.writer===principal&&Number.isSafeInteger(ownership.epoch)&&ownership.epoch>0;
  return {
    schemaVersion:'1',application:'salesleadgenerator',scope:{clientId:brand,tenantId},principalId:principal,checkedAt:new Date().toISOString(),
    transactionCapable:Boolean(hello.logicalSessionTimeoutMinutes&&(hello.setName||hello.msg==='isdbgrid')),
    grant:{present:Boolean(grant),scopeAuthorized:scoped,fields:scoped&&Array.isArray(grant?.fields)?grant.fields.filter((field:unknown):field is string=>typeof field==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(field)).slice(0,100):[]},
    ownership:{checked:scoped,present:scoped?Boolean(ownership):null,writerMatches:owned,epoch:Number.isSafeInteger(ownership?.epoch)?ownership?.epoch:null,legacyFenced:ownership?.legacyFenced===true},
    writesAuthorized:scoped&&owned,customerRecordsRead:0,mutations:0,
  };
}
