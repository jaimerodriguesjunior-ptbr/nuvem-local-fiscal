import {createHmac,timingSafeEqual} from 'node:crypto';

/** Same contract in the GOP receiver. The signature covers exact UTF-8 bytes,
 * purpose and timestamp. Events contain identifiers, never fiscal XML or tokens.
 */
export function signRecoverySync(body:string,secret:string,timestamp:string):string {
  if(secret.length<32)throw new Error('RECOVERY_SYNC_SECRET_REQUIRED');
  return createHmac('sha256',secret).update(`recovery-v1\n${timestamp}\n${body}`).digest('hex');
}
export function verifyRecoverySync(body:string,secret:string,timestamp:string|null,signature:string|null,now=Date.now()):boolean {
  if(secret.length<32||!timestamp||!/^\d{10}$/.test(timestamp)||!signature||!/^[a-f0-9]{64}$/.test(signature)||
    Math.abs(now-Number(timestamp)*1000)>300_000)return false;
  return timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(signRecoverySync(body,secret,timestamp),'hex'));
}
