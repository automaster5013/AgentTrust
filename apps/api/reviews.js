import { randomUUID } from 'node:crypto';
import { InputError } from '../../packages/contracts/index.js';
import { hash } from '../../packages/contracts/hash.js';
import { evaluationPassing } from '../../packages/evaluator/comparison.js';
import { transaction } from './database.js';
import { requireWrite,audit,revalidateSession } from './auth.js';
import { publicRun,terminalStates } from './pg-store.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function publicReview(row){if(hash(row.payload)!==row.review_hash)throw new Error('Review integrity mismatch.');return {...row.payload,reviewHash:row.review_hash};}
export async function latestReview(client,context,runId){
  const row=(await client.query(`SELECT r.*,m.active AND m.role='admin' AS actor_valid FROM agenttrust.run_reviews r
    JOIN agenttrust.memberships m ON m.id=r.actor_id AND m.organization_id=r.organization_id
    WHERE r.organization_id=$1 AND r.project_id=$2 AND r.run_id=$3 ORDER BY r.review_order DESC LIMIT 1`,[context.organizationId,context.projectId,runId])).rows[0];
  return row?{...publicReview(row),actorValid:row.actor_valid}:undefined;
}
export class Reviews{
  constructor(database){this.database=database;}
  async list(context,runId){
    if(!uuid(runId))throw new InputError('Invalid run id.');
    return transaction(this.database,async client=>{
      if(!(await client.query('SELECT id FROM agenttrust.runs WHERE organization_id=$1 AND project_id=$2 AND id=$3',[context.organizationId,context.projectId,runId])).rowCount)throw new InputError('Unknown run.',404);
      return (await client.query('SELECT payload,review_hash FROM agenttrust.run_reviews WHERE organization_id=$1 AND project_id=$2 AND run_id=$3 ORDER BY review_order DESC LIMIT 50',[context.organizationId,context.projectId,runId])).rows.map(publicReview);
    },context.organizationId);
  }
  async create(context,runId,input,key){
    requireWrite(context,true);
    if(!uuid(runId)||!input||Array.isArray(input)||Object.keys(input).some(k=>!['decision','comment'].includes(k))||!['approved','rejected'].includes(input.decision)||input.comment!==undefined&&(typeof input.comment!=='string'||input.comment.length>500))throw new InputError('Expected approval decision and comment of at most 500 characters.');
    if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw new InputError('A valid Idempotency-Key is required.');
    const request={runId,decision:input.decision,comment:input.comment?.trim()||''},requestHash=hash(request);
    return transaction(this.database,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))',[context.organizationId]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4))',[runId]);
      await revalidateSession(client,context,{adminOnly:true});
      const prior=(await client.query('SELECT payload,review_hash,request_hash FROM agenttrust.run_reviews WHERE organization_id=$1 AND project_id=$2 AND actor_id=$3 AND idempotency_key=$4',[context.organizationId,context.projectId,context.membershipId,key])).rows[0];
      if(prior){if(prior.request_hash!==requestHash)throw new InputError('Review idempotency key conflict.',409);return {...publicReview(prior),replay:true};}
      const row=(await client.query('SELECT * FROM agenttrust.runs WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR SHARE',[context.organizationId,context.projectId,runId])).rows[0];
      if(!row)throw new InputError('Unknown run.',404);const run=publicRun(row);
      if(run.snapshot.policy.requiresManualApproval!==true)throw new InputError('This policy does not require manual review.',409);
      if(!terminalStates.has(run.state)||request.decision==='approved'&&!evaluationPassing(run))throw new InputError('Approval requires a completed passing evaluation.',409);
      await revalidateSession(client,context,{adminOnly:true});
      const counts=(await client.query("SELECT count(*) AS total,count(*) FILTER(WHERE created_at>clock_timestamp()-interval '60 seconds') AS recent FROM agenttrust.run_reviews WHERE organization_id=$1",[context.organizationId])).rows[0];
      if(Number(counts.total)>=100000||Number(counts.recent)>=120)throw new InputError('Review quota reached.',429);
      const id=randomUUID(),now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const payload={schemaVersion:1,id,organizationId:context.organizationId,projectId:context.projectId,runId,actorId:context.membershipId,decision:request.decision,comment:request.comment,createdAt:now.toISOString(),snapshotHash:run.snapshotHash,resultHash:run.resultHash},reviewHash=hash(payload);
      await client.query('INSERT INTO agenttrust.run_reviews(id,organization_id,project_id,run_id,actor_id,decision,payload,review_hash,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,context.organizationId,context.projectId,runId,context.membershipId,request.decision,payload,reviewHash,key,requestHash,now]);
      await audit(client,context,'run.review.'+request.decision,id,{runId,reviewHash});
      return {...payload,reviewHash,replay:false};
    },context.organizationId);
  }
}
