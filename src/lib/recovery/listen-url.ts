/** Pin LISTEN to the intended Supabase project/session endpoint. Never include
 * credentials in errors, and prevent URL options from overriding strict TLS. */
export function recoveryListenUrl(value:string,supabaseUrl:string):string {
  try {
    const database=new URL(value),projectUrl=new URL(supabaseUrl);
    if(projectUrl.protocol!=='https:'||!/^([a-z0-9]+)\.supabase\.co$/.test(projectUrl.hostname))throw Error();
    const project=projectUrl.hostname.split('.')[0];
    if(!['postgres:','postgresql:'].includes(database.protocol)||database.pathname!=='/postgres'||(database.port!==''&&database.port!=='5432')||
      !(database.hostname===`db.${project}.supabase.co`||(database.hostname.endsWith('.pooler.supabase.com')&&
        [`postgres.${project}`,`fiscal_recovery_listener.${project}`].includes(decodeURIComponent(database.username)))))throw Error();
    // node-postgres also accepts host/user/options/ssl overrides in URI query
    // parameters. None is needed for these explicitly configured clients.
    database.search='';
    return database.toString();
  }catch{throw new Error('RECOVERY_DATABASE_PROJECT_MISMATCH');}
}

/** Runtime LISTEN connections must never carry the administrative login used
 * by backup/migration tools. Their separate login has no fiscal table grants. */
export function recoveryListenerUrl(value:string,supabaseUrl:string):string {
  const result=recoveryListenUrl(value,supabaseUrl),url=new URL(result),project=new URL(supabaseUrl).hostname.split('.')[0];
  const expected=url.hostname===`db.${project}.supabase.co`?'fiscal_recovery_listener':`fiscal_recovery_listener.${project}`;
  if(decodeURIComponent(url.username)!==expected)throw Error('RECOVERY_DATABASE_LISTENER_ROLE_REQUIRED');
  return result;
}
