import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from './app.js';
test('OG pump starts after listening so its callback lookup cannot hold the boot hook open',async()=>{
  let running=false,started=0,stopped=0;
  const app=buildApp({recovery:null,ogObservation:{get ready(){return running;},async start(){started++;
    const address=app.server.address();assert.ok(address&&typeof address==='object');
    const response=await fetch(`http://127.0.0.1:${address.port}/health`);assert.equal(response.status,200);running=true;},
    async stop(){stopped++;running=false;}}});
  try{
    await app.ready();assert.equal(started,0);assert.equal((await app.inject('/ready')).statusCode,503);
    await app.listen({host:'127.0.0.1',port:0});
    for(let n=0;n<20&&!running;n++)await new Promise(r=>setTimeout(r,10));
    assert.equal(started,1);assert.equal((await app.inject('/ready')).statusCode,200);
  }finally{await app.close();}
  assert.equal(stopped,1);
});
