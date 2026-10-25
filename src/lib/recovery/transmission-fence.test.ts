import test from 'node:test';
import assert from 'node:assert/strict';
import {configureTransmissionFence,assertTransmissionPermit,withInitialTransmissionPermit,
  assertCancellationTransmissionPermit,withCancellationTransmissionPermit} from './transmission-fence.js';
import {fixtureKey,fixtureScope,fixtureSignedXml} from './test-fixtures.js';

test('pilot transport refuses legacy, wrong model, changed bytes and reused permits; other scopes remain independent',async()=>{
  configureTransmissionFence([fixtureScope]);
  try {
    assert.throws(()=>assertTransmissionPermit(fixtureSignedXml,'producao','NFCe'),/LEGACY_SEND_BLOCKED/);
    assert.throws(()=>assertTransmissionPermit(fixtureSignedXml,'producao','NFe'),/MODEL_MISMATCH/);
    assert.doesNotThrow(()=>assertTransmissionPermit(fixtureSignedXml,'homologacao','NFCe'));
    const other=fixtureSignedXml.replaceAll(fixtureKey,fixtureKey.slice(0,22)+'003'+fixtureKey.slice(25));
    assert.doesNotThrow(()=>assertTransmissionPermit(other,'producao','NFCe'));
    await withInitialTransmissionPermit(fixtureKey,fixtureSignedXml,async()=>{
      assert.throws(()=>assertTransmissionPermit(fixtureSignedXml+' ','producao','NFCe'),/LEGACY_SEND_BLOCKED/);
      assert.doesNotThrow(()=>assertTransmissionPermit(fixtureSignedXml,'producao','NFCe'));
      assert.throws(()=>assertTransmissionPermit(fixtureSignedXml,'producao','NFCe'),/LEGACY_SEND_BLOCKED/);
    });
    assert.throws(()=>assertTransmissionPermit(fixtureSignedXml,'producao','NFCe'),/LEGACY_SEND_BLOCKED/);
  }finally{configureTransmissionFence([]);}
});

test('cancellation has a separate one-time permit bound to frozen event bytes and namespace',async()=>{
  configureTransmissionFence([fixtureScope]);
  const batch=`<envEvento><evento><infEvento><chNFe>${fixtureKey}</chNFe></infEvento></evento></envEvento>`;
  const check=(xml=batch,model='NFCe')=>assertCancellationTransmissionPermit(xml,'producao',model,fixtureKey);
  try{
    assert.throws(()=>check(),/LEGACY_CANCEL_BLOCKED/);
    assert.throws(()=>check(batch,'NFe'),/MODEL_MISMATCH/);
    assert.throws(()=>assertCancellationTransmissionPermit(batch,'producao','NFCe','9'.repeat(44)),/IDENTITY_INVALID/);
    assert.doesNotThrow(()=>assertCancellationTransmissionPermit(batch,'homologacao','NFCe',fixtureKey));
    await withInitialTransmissionPermit(fixtureKey,batch,async()=>{assert.throws(()=>check(),/LEGACY_CANCEL_BLOCKED/);});
    await withCancellationTransmissionPermit(fixtureKey,batch,async()=>{
      assert.throws(()=>check(batch+' '),/LEGACY_CANCEL_BLOCKED/);
      assert.throws(()=>assertTransmissionPermit(fixtureSignedXml,'producao','NFCe'),/LEGACY_SEND_BLOCKED/);
      assert.doesNotThrow(()=>check());assert.throws(()=>check(),/LEGACY_CANCEL_BLOCKED/);
    });
    assert.throws(()=>check(),/LEGACY_CANCEL_BLOCKED/);
  }finally{configureTransmissionFence([]);}
});
