/** Pin LISTEN to the intended Supabase project/session endpoint. Never include
 * credentials in errors, and prevent URL options from overriding strict TLS. */
export function recoveryListenUrl(value:string,supabaseUrl:string):string {
  try {
    const database=new URL(value),projectUrl=new URL(supabaseUrl);
    if(projectUrl.protocol!=='https:'||!/^([a-z0-9]+)\.supabase\.co$/.test(projectUrl.hostname))throw Error();
    const project=projectUrl.hostname.split('.')[0];
    if(!['postgres:','postgresql:'].includes(database.protocol)||(database.port!==''&&database.port!=='5432')||
      !(database.hostname===`db.${project}.supabase.co`||(database.hostname.endsWith('.pooler.supabase.com')&&
        decodeURIComponent(database.username)===`postgres.${project}`)))throw Error();
    for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])database.searchParams.delete(key);
    return database.toString();
  }catch{throw new Error('RECOVERY_DATABASE_PROJECT_MISMATCH');}
}
