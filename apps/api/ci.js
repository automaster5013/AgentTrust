import { randomBytes,randomUUID } from 'node:crypto';
import { InputError } from '../../packages/contracts/index.js';
import { hash,tokenHash } from '../../packages/contracts/hash.js';
import { releaseGate } from '../../packages/evaluator/comparison.js';
import { transaction } from './database.js';
import { audit,requireWrite } from './auth.js';
import { publicRun } from './pg-store.js';
import { loadReceiptSigner } from '../../packages/receipts/signature.js';
import { pageResult } from './pagination.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function receiptArtifact(row){
  const artifact={schemaVersion:1,receiptId:row.id,organizationId:row.organization_id,projectId:row.project_id,checkedAt:row.created_at.toISOString(),request:row.request,result:row.result,
    evidence:{candidate:{runId:row.candidate_run_id,snapshotHash:row.candidate_snapshot_hash,resultHash:row.candidate_result_hash},...(row.baseline_run_id?{baseline:{runId:row.baseline_run_id,snapshotHash:row.baseline_snapshot_hash,resultHash:row.baseline_result_hash}}:{})}};
  if(hash(artifact)!==row.artifact_hash)throw new Error('Receipt integrity mismatch.');
  return {artifact,artifactHash:row.artifact_hash,...(row.signature?{signature:row.signature}:{})};
}
export class CI {
  constructor(database,{checkLimitPerMinute=120,receiptQuota=100000,signer=loadReceiptSigner()}={}){
    if(!Number.isInteger(checkLimitPerMinute)||checkLimitPerMinute<1||checkLimitPerMinute>120||!Number.isInteger(receiptQuota)||receiptQuota<1||receiptQuota>100000)throw new Error('Invalid CI limits.');
    this.database=database;this.checkLimitPerMinute=checkLimitPerMinute;this.receiptQuota=receiptQuota;this.signer=signer;
  }
  async authenticate(token){
    if(typeof token!=='string'||!/^atci_[a-f0-9]{64}$/.test(token))throw new InputError('Invalid CI credential.',401);
    const result=await this.database.query('SELECT * FROM agenttrust.authenticate_ci($1)',[tokenHash(token)]);
    if(!result.rowCount)throw new InputError('CI credential expired or revoked.',401);
    const row=result.rows[0];return {organizationId:row.organization_id,projectId:row.project_id,serviceCredentialId:row.id,name:row.name,role:'ci'};
  }
  async create(context,input){
    requireWrite(context,true);
    if(!input||Object.keys(input).some(k=>!['name','ttlSeconds','projectId'].includes(k))||typeof input.name!=='string'||input.name.trim().length<1||input.name.length>100||!Number.isInteger(input.ttlSeconds)||input.ttlSeconds<60||input.ttlSeconds>2592000||!uuid(input.projectId))throw new InputError('Expected name, projectId and ttlSeconds (60..2592000).');
    return transaction(this.database,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,2))',[context.organizationId]);
      const project=await client.query('SELECT id FROM agenttrust.projects WHERE organization_id=$1 AND id=$2',[context.organizationId,input.projectId]);
      if(!project.rowCount)throw new InputError('Unknown project.',404);
      const counts=(await client.query("SELECT count(*) AS total,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>now()) AS active,count(*) FILTER(WHERE created_at>clock_timestamp()-interval '60 seconds') AS recent FROM agenttrust.ci_credentials WHERE organization_id=$1",[context.organizationId])).rows[0];
      if(Number(counts.active)>=100)throw new InputError('Active CI credential quota reached.',429);
      if(Number(counts.total)>=10000)throw new InputError('Organization CI credential history quota reached.',429);
      if(Number(counts.recent)>=20)throw new InputError('Too many CI credential requests. Try again in one minute.',429);
      const id=randomUUID(),token='atci_'+randomBytes(32).toString('hex');
      const row=(await client.query("INSERT INTO agenttrust.ci_credentials(id,organization_id,project_id,name,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+$7::integer*interval '1 second') RETURNING id,project_id,name,created_at,expires_at",[id,context.organizationId,input.projectId,input.name.trim(),tokenHash(token),context.membershipId,input.ttlSeconds])).rows[0];
      await audit(client,context,'ci.credential.created',id,{projectId:input.projectId,expiresAt:row.expires_at.toISOString()});
      return {...row,token};
    },context.organizationId);
  }
  async list(context,page){
    requireWrite(context,true);
    return transaction(this.database,async client=>{
      const rows=(await client.query(`SELECT id,project_id,name,created_at,expires_at,revoked_at,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
        FROM agenttrust.ci_credentials WHERE organization_id=$1 AND project_id=$2
        AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))
        ORDER BY created_at DESC,id DESC LIMIT $5`,[context.organizationId,context.projectId,page?.cursor?.time||null,page?.cursor?.id||null,page?page.limit+1:200])).rows;
      return page?pageResult(rows,page,context):rows.map(({cursor_time,...row})=>row);
    },context.organizationId);
  }
  async revoke(context,id){
    requireWrite(context,true);if(!uuid(id))throw new InputError('Invalid credential id.');
    return transaction(this.database,async client=>{
      const row=(await client.query('SELECT id,revoked_at FROM agenttrust.ci_credentials WHERE organization_id=$1 AND id=$2 FOR UPDATE',[context.organizationId,id])).rows[0];
      if(!row)throw new InputError('Unknown credential.',404);
      if(!row.revoked_at){await client.query('UPDATE agenttrust.ci_credentials SET revoked_at=clock_timestamp() WHERE id=$1',[id]);await audit(client,context,'ci.credential.revoked',id);}
      return {id,revoked:true};
    },context.organizationId);
  }
  async check(context,input,idempotencyKey){
    if(idempotencyKey!==undefined&&(typeof idempotencyKey!=='string'||!/^[-a-zA-Z0-9_]{8,100}$/.test(idempotencyKey)))throw new InputError('Idempotency-Key must contain 8..100 letters, digits, hyphens or underscores.');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['candidateRunId','baselineRunId','agentVersionId','datasetVersionId','policyVersionId','maxAgeSeconds'].includes(k))||!uuid(input.candidateRunId)||input.baselineRunId!==undefined&&!uuid(input.baselineRunId))throw new InputError('Invalid release check request.');
    if(input.maxAgeSeconds!==undefined&&(!Number.isInteger(input.maxAgeSeconds)||input.maxAgeSeconds<1||input.maxAgeSeconds>86400))throw new InputError('maxAgeSeconds must be 1..86400.');
    for(const key of ['agentVersionId','datasetVersionId','policyVersionId'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>80))throw new InputError('Expected version identifiers of at most 80 characters.');
    return transaction(this.database,async client=>{
      // Lock the credential for the check transaction; revocation takes effect before the next check.
      if(context.serviceCredentialId){
        const valid=await client.query("SELECT c.id FROM agenttrust.ci_credentials c JOIN agenttrust.memberships m ON m.id=c.created_by WHERE c.id=$1 AND c.organization_id=$2 AND c.project_id=$3 AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND m.active AND m.role='admin' FOR SHARE OF c",[context.serviceCredentialId,context.organizationId,context.projectId]);
        if(!valid.rowCount)throw new InputError('CI credential expired or revoked.',401);
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,3))',[context.organizationId]);
      const principalKey=context.serviceCredentialId?`ci:${context.serviceCredentialId}`:`member:${context.membershipId}`;
      const requestHash=hash(input);
      const previous=idempotencyKey?(await client.query('SELECT * FROM agenttrust.release_receipts WHERE organization_id=$1 AND project_id=$2 AND principal_key=$3 AND idempotency_key=$4',[context.organizationId,context.projectId,principalKey,idempotencyKey])).rows[0]:undefined;
      if(previous&&previous.request_hash!==requestHash)throw new InputError('Idempotency key was used for a different release check.',409);
      const read=async id=>{
        const row=(await client.query('SELECT * FROM agenttrust.runs WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR SHARE',[id,context.organizationId,context.projectId])).rows[0];
        if(!row)throw new InputError('Unknown run.',404);return publicRun(row);
      };
      const candidate=await read(input.candidateRunId),baseline=input.baselineRunId?await read(input.baselineRunId):undefined;
      const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const result=releaseGate(candidate,input,baseline,now.getTime());
      if(previous){
        if(hash(previous.result)!==hash(result))throw new InputError('Previous release check is no longer current. Use a new idempotency key.',409);
        return {...result,...receiptArtifact(previous)};
      }
      const counts=(await client.query("SELECT count(*) AS total,count(*) FILTER(WHERE created_at>clock_timestamp()-interval '60 seconds') AS recent FROM agenttrust.release_receipts WHERE organization_id=$1",[context.organizationId])).rows[0];
      if(Number(counts.total)>=this.receiptQuota)throw new InputError('Organization release receipt quota reached.',429);
      if(Number(counts.recent)>=this.checkLimitPerMinute)throw new InputError('Too many release checks. Try again in one minute.',429);
      const receiptId=randomUUID();
      const artifact={schemaVersion:1,receiptId,organizationId:context.organizationId,projectId:context.projectId,checkedAt:now.toISOString(),request:input,result,
        evidence:{candidate:{runId:candidate.id,snapshotHash:candidate.snapshotHash,resultHash:candidate.resultHash},...(baseline?{baseline:{runId:baseline.id,snapshotHash:baseline.snapshotHash,resultHash:baseline.resultHash}}:{})}};
      const artifactHash=hash(artifact);
      const signature=this.signer?.sign(artifact);
      await client.query('INSERT INTO agenttrust.release_receipts(id,organization_id,project_id,candidate_run_id,baseline_run_id,service_credential_id,actor_id,request,result,candidate_snapshot_hash,candidate_result_hash,baseline_snapshot_hash,baseline_result_hash,artifact_hash,created_at,principal_key,idempotency_key,request_hash,signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)',[receiptId,context.organizationId,context.projectId,candidate.id,baseline?.id||null,context.serviceCredentialId||null,context.membershipId||null,input,result,candidate.snapshotHash,candidate.resultHash,baseline?.snapshotHash||null,baseline?.resultHash||null,artifactHash,now,principalKey,idempotencyKey||null,requestHash,signature||null]);
      await audit(client,context,'ci.release.checked',receiptId,{projectId:context.projectId,runId:candidate.id,serviceCredentialId:context.serviceCredentialId||null,decision:result.decision,artifactHash});
      return {...result,artifact,artifactHash,...(signature?{signature}:{})};
    },context.organizationId);
  }
  async receipts(context,page){
    return transaction(this.database,async client=>{
      const rows=(await client.query(`SELECT id,candidate_run_id,baseline_run_id,created_at,artifact_hash,result->>'decision' AS decision,signature->>'keyId' AS signing_key_id,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
        FROM agenttrust.release_receipts WHERE organization_id=$1 AND project_id=$2
        AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))
        ORDER BY created_at DESC,id DESC LIMIT $5`,[context.organizationId,context.projectId,page?.cursor?.time||null,page?.cursor?.id||null,page?page.limit+1:100])).rows;
      return page?pageResult(rows,page,context):rows.map(({cursor_time,...row})=>row);
    },context.organizationId);
  }
  async receipt(context,id){
    if(!uuid(id))throw new InputError('Invalid receipt id.');
    return transaction(this.database,async client=>{
      const row=(await client.query('SELECT * FROM agenttrust.release_receipts WHERE id=$1 AND organization_id=$2 AND project_id=$3',[id,context.organizationId,context.projectId])).rows[0];
      if(!row)throw new InputError('Unknown release receipt.',404);
      return receiptArtifact(row);
    },context.organizationId);
  }
}
