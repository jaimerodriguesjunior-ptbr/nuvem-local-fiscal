import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryListenUrl,recoveryListenerUrl} from './listen-url.js';
test('runtime listeners use a dedicated login pinned to their project and session port',()=>{
  const project='abcdefghijklmnopqrst',base=`https://${project}.supabase.co`;
  const session=`postgresql://fiscal_recovery_listener.${project}:fixture@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;
  assert.equal(recoveryListenerUrl(session,base),session);
  assert.doesNotThrow(()=>recoveryListenerUrl(`postgresql://fiscal_recovery_listener:fixture@db.${project}.supabase.co/postgres`,base));
  assert.throws(()=>recoveryListenerUrl(session.replace('fiscal_recovery_listener.','postgres.'),base),/LISTENER_ROLE_REQUIRED/);
  assert.throws(()=>recoveryListenerUrl(`postgresql://postgres:fixture@db.${project}.supabase.co/postgres`,base),/LISTENER_ROLE_REQUIRED/);
  for(const value of [session.replace(project,'wrongproject'),session.replace('5432','6543'),session.replace('fiscal_recovery_listener','another_role')])
    assert.throws(()=>recoveryListenerUrl(value,base),/PROJECT_MISMATCH/);
  const strict=new URL(recoveryListenerUrl(session+'?sslmode=disable&sslrootcert=untrusted',base));
  assert.equal(strict.search,'');
  assert.equal(new URL(recoveryListenerUrl(session+'?host=attacker.example&user=postgres&ssl=false&options=unsafe',base)).search,'');
  assert.throws(()=>recoveryListenerUrl(session.replace('/postgres','/template1'),base),/PROJECT_MISMATCH/);
  // Administrative operations remain explicit and separate from the runtime.
  assert.doesNotThrow(()=>recoveryListenUrl(session.replace('fiscal_recovery_listener.','postgres.'),base));
});
