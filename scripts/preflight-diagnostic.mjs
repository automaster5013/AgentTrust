export const preflightChecks=Object.freeze([
  ['inputs','PREFLIGHT_INPUTS','Set an immutable GHCR digest, its full commit SHA and a backup age limit greater than 0 and at most 168 hours.'],
  ['compose-config','PREFLIGHT_COMPOSE','Privately check .env, Compose files and Docker Compose availability; do not print resolved secrets.'],
  ['cached-image','PREFLIGHT_IMAGE','Separately pull the verified digest and check its revision, source and isolation settings.'],
  ['signing-key-pair','PREFLIGHT_SIGNING','Privately check the existing Ed25519 key pair and API-only secret mount; do not overwrite keys.'],
  ['database-target','PREFLIGHT_DATABASE_TARGET','Check that OWNER_DATABASE_URL matches the selected loopback Compose database; do not change grants.'],
  ['database-migration-ledger','PREFLIGHT_DATABASE_STATE','Check database connectivity, the local Git revision and applied migration checksums; review changes before applying migrations.'],
  ['backup-and-prior-restore','PREFLIGHT_RECOVERY','Privately check backup age, ciphertext, key, restore report and migration/security fingerprints; investigate differences before separately creating new recovery evidence.']
].map(([id,code,guidance])=>Object.freeze({id,code,guidance})));

// Only fixed identifiers and guidance reach output. Never serialize caught errors,
// assertions, Docker stderr, connection strings or untrusted stage values.
export function preflightDiagnostic(failedCheck=null){
  const index=failedCheck===null?-1:preflightChecks.findIndex(check=>check.id===failedCheck);
  const failed=failedCheck===null?-1:Math.max(index,0);
  const checks=preflightChecks.map((check,i)=>({id:check.id,status:failed===-1||i<failed?'passed':i===failed?'blocked':'not_run'}));
  return {schemaVersion:1,status:failed===-1?'passed':'blocked',checks,...(failed===-1?{}:{failedCheck:preflightChecks[failed].id,code:preflightChecks[failed].code,guidance:preflightChecks[failed].guidance}),readOnly:true,checkedAt:new Date().toISOString()};
}
