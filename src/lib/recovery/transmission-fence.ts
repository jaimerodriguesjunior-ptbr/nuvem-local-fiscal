import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

type Namespace = { cnpj: string; series: number; model: "NFe" | "NFCe" };
const permits = new AsyncLocalStorage<{ key: string; hash: string; consumed: boolean }>();
const cancellationPermits = new AsyncLocalStorage<{key:string;hash:string;consumed:boolean}>();
let protectedNamespaces: readonly Namespace[] = [];

/** Installed only after runtime configuration/database readiness succeeds. */
export function configureTransmissionFence(namespaces: readonly Namespace[]) {
  protectedNamespaces = namespaces.map(value => ({ ...value }));
}

export function isRecoveryNamespace(cnpj: string, environment: string, model: string, series: number): boolean {
  return environment === "producao" && protectedNamespaces.some(scope =>
    scope.cnpj === cnpj && scope.model === model && scope.series === series);
}
/** Managed callers must never silently fall through to a legacy transmitter
 * when a new store's central scope has not yet been registered/enabled. */
export function hasManagedSubmissionHeaders(headers:Record<string,unknown>):boolean {
  return ['x-recovery-request-id','x-recovery-origin-id','x-recovery-store-id','x-recovery-organization-id','x-recovery-resume-local']
    .some(name=>headers[name]!==undefined);
}

export async function withInitialTransmissionPermit<T>(key: string, xml: string, operation: () => Promise<T>): Promise<T> {
  return permits.run({ key, hash: createHash("sha256").update(xml).digest("hex"), consumed: false }, operation);
}

/** Lowest transport boundary: legacy POST/admin/process calls cannot bypass it.
 * A permit exists only after committing the durable, one-time send intent.
 */
export function assertTransmissionPermit(xml: string, environment: string, model: string) {
  if (environment !== "producao" || protectedNamespaces.length === 0) return;
  const keys = [...xml.matchAll(/\bId=["']NFe(\d{44})["']/g)].map(match => match[1]);
  if (keys.length !== 1) throw new Error("RECOVERY_SEND_IDENTITY_INVALID");
  const key = keys[0];
  const keyModel=key.slice(20,22)==='55'?'NFe':key.slice(20,22)==='65'?'NFCe':'';
  if (!isRecoveryNamespace(key.slice(6,20), environment, keyModel, Number(key.slice(22,25)))) return;
  if(keyModel!==model) throw new Error('RECOVERY_SEND_MODEL_MISMATCH');
  const permit = permits.getStore();
  if (!permit || permit.consumed || permit.key !== key ||
      permit.hash !== createHash("sha256").update(xml).digest("hex")) throw new Error("RECOVERY_LEGACY_SEND_BLOCKED");
  permit.consumed = true;
}

export async function withCancellationTransmissionPermit<T>(key:string,batchXml:string,operation:()=>Promise<T>):Promise<T> {
  return cancellationPermits.run({key,hash:createHash('sha256').update(batchXml).digest('hex'),consumed:false},operation);
}

/** A cancellation permit is independent of authorization and applies to the
 * exact event batch persisted before its one-time send intent. */
export function assertCancellationTransmissionPermit(batchXml:string,environment:string,model:string,expectedKey:string) {
  if(environment!=='producao'||protectedNamespaces.length===0)return;
  const keys=[...batchXml.matchAll(/<(?:[\w]+:)?chNFe>\s*(\d{44})\s*<\/(?:[\w]+:)?chNFe>/g)].map(match=>match[1]);
  if(keys.length!==1||keys[0]!==expectedKey)throw new Error('RECOVERY_CANCEL_IDENTITY_INVALID');
  const key=keys[0],keyModel=key.slice(20,22)==='55'?'NFe':key.slice(20,22)==='65'?'NFCe':'';
  if(!isRecoveryNamespace(key.slice(6,20),environment,keyModel,Number(key.slice(22,25))))return;
  if(keyModel!==model)throw new Error('RECOVERY_CANCEL_MODEL_MISMATCH');
  const permit=cancellationPermits.getStore();
  if(!permit||permit.consumed||permit.key!==key||permit.hash!==createHash('sha256').update(batchXml).digest('hex')) {
    throw new Error('RECOVERY_LEGACY_CANCEL_BLOCKED');
  }
  permit.consumed=true;
}
