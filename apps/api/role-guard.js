// Validate the effective principal, including SET ROLE escalation paths.
export async function validateDatabaseRole(database,service){
  if(!['api','worker'].includes(service))throw new Error('Unknown application database role.');
  const expected='agenttrust_'+service;
  const row=(await database.query(`SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
    EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS memberships,
    has_schema_privilege(r.oid,'agenttrust','CREATE') AS schema_create,
    has_database_privilege(r.oid,current_database(),'CREATE') AS database_create,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='agenttrust' AND c.relowner=r.oid) AS owns_tables,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='agenttrust' AND p.proowner=r.oid) AS owns_functions
    FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
  if(!row||row.rolname!==expected||row.rolcanlogin!==true||row.rolbypassrls!==(service==='worker')||
    ['rolsuper','rolcreaterole','rolcreatedb','rolreplication','memberships','schema_create','database_create','owns_tables','owns_functions'].some(flag=>row[flag]!==false)){
    throw new Error('Unsafe application database role configuration.');
  }
}
