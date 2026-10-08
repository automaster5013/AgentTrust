import {validateDatabaseRole} from '../../apps/api/role-guard.js';

// This is dependency readiness, not customer acceptance or a release authorization.
export async function inspectServiceReadiness(database,service='api') {
  if(!['api','worker'].includes(service))throw new Error('Unknown readiness service.');
  const checks={database:'unavailable',worker:'unknown'};
  try {
    await validateDatabaseRole(database,service);
    const rows=(await database.query("SELECT EXTRACT(EPOCH FROM (clock_timestamp()-last_seen))::double precision AS age_seconds FROM agenttrust.service_health WHERE service='worker'")).rows;
    checks.database='ready';
    if(rows.length===0)checks.worker='missing';
    else if(rows.length===1&&typeof rows[0].age_seconds==='number'&&Number.isFinite(rows[0].age_seconds)&&rows[0].age_seconds>=0&&rows[0].age_seconds<=15)checks.worker='recent';
    else checks.worker='stale';
  } catch { /* Never publish database errors, identities, timestamps or connection settings. */ }
  return {status:checks.database==='ready'&&checks.worker==='recent'?'ready':'not-ready',mode:'local-mock',checks};
}
