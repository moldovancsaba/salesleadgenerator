/** Isolated loopback transaction and provenance verification; never runs on a customer database. */
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { executeOperation,parseOperation,lookup,revision } from '../lib/integrations/operations';
async function main(){
 const uri=process.env.EXCHANGE_TEST_MONGODB_URI;if(!uri||new URL(uri).hostname!=='127.0.0.1')throw new Error('Loopback test database required');
 const client=new MongoClient(uri);await client.connect();const db=client.db('px_slg_'+randomUUID().replaceAll('-','').slice(0,20));
 try{
  for(const name of ['seyu_leads','integration_operations','integration_ownership','integration_identities','integration_writer_grants'])await db.createCollection(name);
  await db.collection('integration_writer_grants').insertOne({_id:'test-key',active:true,reviewRef:'isolated-test-review',clients:['seyu'],tenants:['default'],fields:['address']} as never);
  await db.collection('integration_ownership').insertOne({_id:'seyu:default',active:true,reviewRef:'isolated-test-review',writer:'test-key',epoch:1} as never);
  const inserted=await db.collection('seyu_leads').insertOne({id:'fixture',entity_name:'Fixture Example',address:'Old address',tenantId:'default',url:'https://fixture.example/',country:'HU',kanbanColumn:'DISCOVERED',ice:{impact:5,confidence:5,ease:5}});
  const current=(await db.collection('seyu_leads').findOne({_id:inserted.insertedId}))!;
  const op=parseOperation({operationId:randomUUID(),clientId:'seyu',tenantId:'default',writerEpoch:1,action:'update',entityType:'lead',targetId:'fixture',expectedRevision:revision(current),patch:{address:'1 Main Street'},evidence:[{field:'address',sourceUrl:'https://fixture.example/contact',observedAt:'2026-11-02T10:00:00Z',method:'official'}]});const raw=JSON.stringify(op);
  const brand={label:'Fixture',dbCollection:'seyu_leads',apiPrefix:'/seyu',currency:'USD',aliases:[],ownNameTerms:[]} as never;
  const first=await executeOperation(db,client,'test-key',op,raw,brand,[]);const replay=await executeOperation(db,client,'test-key',op,raw,brand,[]);assert.deepEqual(first,replay);
  const result=await lookup(db,'test-key',{clientId:'seyu',tenantId:'default',leadIds:['fixture'],fieldPaths:['address']},brand);
  assert.equal(result.results[0].found,true);assert.equal(result.results[0].provenance?.[0].sourceUrl,'https://fixture.example/contact');assert.equal(result.results[0].publication?.isPublished,false);
  const bad={...op,operationId:randomUUID(),tenantId:'other'};await assert.rejects(executeOperation(db,client,'test-key',bad,JSON.stringify(bad),brand,[]));assert.equal(await db.collection('integration_operations').countDocuments(),1);
  console.log(JSON.stringify({workspace_update_replay_persisted_provenance_and_isolation:'passed',production_data_touched:false}));
 }finally{try{await db.dropDatabase();}finally{await client.close();}}
}
main().catch(e=>{console.error(JSON.stringify({code:e.code||e.constructor.name,message:String(e.message).slice(0,100)}));process.exitCode=1;});
