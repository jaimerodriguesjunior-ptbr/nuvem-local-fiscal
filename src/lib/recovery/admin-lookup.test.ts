import assert from 'node:assert/strict';
import {test} from 'node:test';
import Fastify from 'fastify';
import {registerAdminRoutes} from '../../routes/admin.js';
import {InMemoryStore} from '../../store.js';
import {config} from '../../config.js';

test('admin managed lookup authenticates before reads and removes encrypted settings from its read-only snapshot',async()=>{
 const app=Fastify({logger:false});let reads=0;
 const id='rv1_11111111-1111-4111-8111-111111111111';
 app.decorate('store',{getSnapshot:()=>({documents:[],summary:{documents:0}}),getDocumentSnapshot:InMemoryStore.prototype.getDocumentSnapshot} as any);
 app.decorate('recovery',{async findDocument(value:string){reads++;assert.equal(value,id);return {id,numero:3388,nfceConfigEncrypted:'must-not-leak',recovery:{phase:'pending'}};}} as any);
 await registerAdminRoutes(app);
 const url='/admin/api/snapshot?managed='+id;
 assert.equal((await app.inject({url})).statusCode,401);assert.equal(reads,0);
 const authorization='Basic '+Buffer.from(config.adminUsername+':'+config.adminPassword).toString('base64');
 assert.equal((await app.inject({url:'/admin/api/snapshot?managed=invalid',headers:{authorization}})).statusCode,400);assert.equal(reads,0);
 const response=await app.inject({url,headers:{authorization}});assert.equal(response.statusCode,200);assert.equal(reads,1);
 assert.equal(response.json().summary.documents,1);assert.equal(response.json().documents[0].id,id);assert.equal(response.body.includes('must-not-leak'),false);
 const page=await app.inject({url:'/admin'});const script=page.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.ok(script);assert.doesNotThrow(()=>new Function(script));
 await app.close();
});
