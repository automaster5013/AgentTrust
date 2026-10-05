import { randomUUID } from 'node:crypto';
import { validate, InputError } from '../../packages/contracts/index.js';
import { hash } from '../../packages/contracts/hash.js';
import { transaction } from './database.js';
import { audit, requireWrite,revalidateSession } from './auth.js';
import { pageResult } from './pagination.js';

export const terminalStates = new Set(['succeeded','failed','cancelled','timed_out']);
import { incomplete } from '../../packages/evaluator/outcome.js';
import {RunQuotaError} from '../../packages/contracts/run-quota-error.js';
export { incomplete };
function uuid(value) { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '')) throw new InputError('Invalid resource id.'); return value; }
function trustedVersion(row){
  try{if(hash(row.data)!==row.content_hash)throw new Error();validate(row.kind,row.data);}
  catch{throw new Error('Stored version evidence is invalid.');}
  return row.data;
}
export function publicRun(row) {
  const outcome = row.outcome || incomplete(row.state,'Evaluation has not completed.');
  return { id:row.id, organizationId:row.organization_id, projectId:row.project_id,
    agentVersionId:row.agent_version_id,datasetVersionId:row.dataset_version_id,policyVersionId:row.policy_version_id,
    state:row.state,createdAt:row.created_at.toISOString(),startedAt:row.started_at?.toISOString(),completedAt:row.completed_at?.toISOString(),
    snapshot:row.snapshot,snapshotHash:row.snapshot_hash,resultHash:row.result_hash,attempts:row.attempts,
    budget:{ timeoutMs:row.timeout_ms,caseBudget:row.case_budget,maxAttempts:row.max_attempts },
    results:outcome.results,summary:outcome.summary,gate:outcome.gate };
}
export async function finalize(client,row,outcome,context = {}) {
  await client.query(`UPDATE agenttrust.runs SET state=$2,outcome=$3,result_hash=$4,completed_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE id=$1`,[row.id,outcome.state,outcome,hash({results:outcome.results,gate:outcome.gate})]);
  await recordCompletion(client,row,outcome,context);
}
export async function recordCompletion(client,row,outcome,context={}){
  await client.query('INSERT INTO agenttrust.usage_events(organization_id,run_id,attempts,evaluated_cases) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[row.organization_id,row.id,row.attempts,outcome.results.length]);
  await audit(client,{...context,organizationId:row.organization_id},`run.${outcome.state}`,row.id,{attempts:row.attempts,gate:outcome.gate.decision});
}
export class PgStore {
  constructor(database) { this.database=database; }
  async operations(context){
    requireWrite(context,true);
    return transaction(this.database,async client=>{
      const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const health=(await client.query("SELECT last_seen FROM agenttrust.service_health WHERE service='worker'")).rows[0];
      const age=health?Math.floor((now-health.last_seen)/1000):null;
      const row=(await client.query(`SELECT count(*) FILTER(WHERE state='queued') AS queued,
        count(*) FILTER(WHERE state='running') AS running,
        count(*) FILTER(WHERE state IN ('queued','running') AND deadline<=$3) AS overdue,
        count(*) FILTER(WHERE state='running' AND lease_until<=$3) AS expired_leases,
        min(created_at) FILTER(WHERE state='queued') AS oldest_queued_at,
        count(*) FILTER(WHERE completed_at>$3::timestamptz-interval '24 hours') AS completed_24h,
        count(*) FILTER(WHERE completed_at>$3::timestamptz-interval '24 hours' AND state IN ('failed','timed_out')) AS errors_24h,
        max(completed_at) AS last_completed_at FROM agenttrust.runs WHERE organization_id=$1 AND project_id=$2`,[context.organizationId,context.projectId,now])).rows[0];
      return {projectId:context.projectId,observedAt:now.toISOString(),worker:{state:age===null?'missing':age>=0&&age<=15?'recent':'stale',lastSeen:health?.last_seen.toISOString()||null,ageSeconds:age},
        queue:{queued:Number(row.queued),running:Number(row.running),overdue:Number(row.overdue),expiredLeases:Number(row.expired_leases),oldestQueuedAt:row.oldest_queued_at?.toISOString()||null},
        recent:{completed24h:Number(row.completed_24h),errors24h:Number(row.errors_24h),lastCompletedAt:row.last_completed_at?.toISOString()||null}};
    },context.organizationId);
  }
  async createProject(context,input,key){
    requireWrite(context,true);
    if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>k!=='name')||typeof input.name!=='string'||input.name.trim().length<1||input.name.length>100)throw new InputError('Project name must contain 1-100 characters.');
    if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw new InputError('Idempotency-Key must contain 8-100 letters, digits, underscores or hyphens.');
    const data={name:input.name.trim()},fingerprint=hash(data);
    return transaction(this.database,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[context.organizationId]);
      await revalidateSession(client,context,{adminOnly:true});
      const prior=(await client.query('SELECT id,name,creation_hash,created_at FROM agenttrust.projects WHERE organization_id=$1 AND creation_key=$2',[context.organizationId,key])).rows[0];
      if(prior){if(prior.creation_hash!==fingerprint)throw new InputError('Idempotency key conflicts with another project.',409);return {id:prior.id,name:prior.name,createdAt:prior.created_at.toISOString(),replay:true};}
      const count=Number((await client.query('SELECT count(*) FROM agenttrust.projects WHERE organization_id=$1',[context.organizationId])).rows[0].count);
      if(count>=100)throw new InputError('Organization project quota reached.',429);
      const id=randomUUID(),row=(await client.query('INSERT INTO agenttrust.projects(id,organization_id,name,creation_key,creation_hash) VALUES($1,$2,$3,$4,$5) RETURNING created_at',[id,context.organizationId,data.name,key,fingerprint])).rows[0];
      await audit(client,context,'project.created',id,{});
      return {id,name:data.name,createdAt:row.created_at.toISOString(),replay:false};
    },context.organizationId);
  }
  async catalog(context) {
    return transaction(this.database, async client => {
      const rows = (await client.query(`SELECT id,kind,content_hash,created_at,data->>'name' AS name,data->>'mode' AS mode,CASE WHEN kind='dataset' THEN jsonb_array_length(data->'cases') END AS case_count,data->'minimumPassRate' AS minimum_pass_rate,data->'requiresManualApproval' AS requires_manual_approval,data->'manualApprovalTtlSeconds' AS manual_approval_ttl FROM agenttrust.versions WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at,id`,[context.organizationId,context.projectId])).rows;
      const result={agent:[],dataset:[],policy:[]};
      for(const row of rows) result[row.kind].push({id:row.id,name:row.name,contentHash:row.content_hash,createdAt:row.created_at.toISOString(),mode:row.mode||undefined,cases:row.case_count??undefined,...(row.kind==='policy'?{minimumPassRate:row.minimum_pass_rate,requiresManualApproval:row.requires_manual_approval===true,manualApprovalTtlSeconds:row.requires_manual_approval===true?row.manual_approval_ttl??3600:undefined}:{})});
      return result;
    },context.organizationId);
  }
  async getVersion(context,id){
    uuid(id);
    return transaction(this.database,async client=>{
      const row=(await client.query('SELECT id,kind,data,content_hash,created_at FROM agenttrust.versions WHERE id=$1 AND organization_id=$2 AND project_id=$3',[id,context.organizationId,context.projectId])).rows[0];
      if(!row)throw new InputError('Version not found.',404);
      return {id:row.id,kind:row.kind,data:trustedVersion(row),contentHash:row.content_hash,createdAt:row.created_at.toISOString()};
    },context.organizationId);
  }
  async createVersion(context,kind,input) {
    requireWrite(context,kind==='policy'); const data=validate(kind,input);
    return transaction(this.database,async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[context.organizationId]);
      await revalidateSession(client,context,{write:true,adminOnly:kind==='policy'});
      const count=await client.query('SELECT count(*) FROM agenttrust.versions WHERE organization_id=$1',[context.organizationId]);
      if(Number(count.rows[0].count)>=1000) throw new InputError('Organization version quota reached.',429);
      const id=randomUUID(); const contentHash=hash(data);
      const row=(await client.query('INSERT INTO agenttrust.versions(id,organization_id,project_id,kind,data,content_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING created_at',[id,context.organizationId,context.projectId,kind,data,contentHash])).rows[0];
      await audit(client,context,`${kind}.version.created`,id,{contentHash});
      return {...data,id,contentHash,createdAt:row.created_at.toISOString()};
    },context.organizationId);
  }
  async createRun(context,input,key) {
    requireWrite(context); const request=validate('run',input);
    for(const kind of ['agent','dataset','policy']) uuid(request[`${kind}VersionId`]);
    if(typeof key!=='string'|| !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new InputError('Idempotency-Key must contain 8-100 letters, digits, underscores or hyphens.');
    const normalized={...request,timeoutMs:request.timeoutMs??30000,caseBudget:request.caseBudget??100,maxAttempts:request.maxAttempts??3};
    const fingerprint=hash(normalized);
    return transaction(this.database, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[context.organizationId]);
      await revalidateSession(client,context,{write:true});
      const previous=await client.query('SELECT * FROM agenttrust.runs WHERE organization_id=$1 AND project_id=$2 AND idempotency_key=$3',[context.organizationId,context.projectId,key]);
      if(previous.rowCount) {
        if(previous.rows[0].fingerprint!==fingerprint) throw new InputError('Idempotency key conflicts with another request.',409);
        return {run:publicRun(previous.rows[0]),replay:true};
      }
      const count=await client.query("SELECT count(*) AS total,count(*) FILTER(WHERE state IN ('queued','running')) AS active FROM agenttrust.runs WHERE organization_id=$1",[context.organizationId]);
      if(Number(count.rows[0].total)>=10000)throw new RunQuotaError('history');
      if(Number(count.rows[0].active)>=10)throw new RunQuotaError('active');
      const snapshot={};
      for(const kind of ['agent','dataset','policy']) {
        const result=await client.query('SELECT * FROM agenttrust.versions WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND kind=$4',[request[`${kind}VersionId`],context.organizationId,context.projectId,kind]);
        if(!result.rowCount) throw new InputError(`Unknown ${kind} version.`,404);
        const v=result.rows[0]; snapshot[kind]={...trustedVersion(v),id:v.id,contentHash:v.content_hash,createdAt:v.created_at.toISOString()};
      }
      const id=randomUUID();
      const result=await client.query(`INSERT INTO agenttrust.runs(id,organization_id,project_id,agent_version_id,dataset_version_id,policy_version_id,idempotency_key,fingerprint,snapshot,snapshot_hash,timeout_ms,case_budget,max_attempts,deadline)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,clock_timestamp()+$11::integer*interval '1 millisecond') RETURNING *`,[id,context.organizationId,context.projectId,request.agentVersionId,request.datasetVersionId,request.policyVersionId,key,fingerprint,snapshot,hash(snapshot),normalized.timeoutMs,normalized.caseBudget,normalized.maxAttempts]);
      await audit(client,context,'run.queued',id,{snapshotHash:hash(snapshot)});
      return {run:publicRun(result.rows[0]),replay:false};
    },context.organizationId);
  }
  async getRun(context,id) {
    uuid(id);
    return transaction(this.database,async client => {
      const result=await client.query('SELECT * FROM agenttrust.runs WHERE id=$1 AND organization_id=$2 AND project_id=$3',[id,context.organizationId,context.projectId]);
      if(!result.rowCount) throw new InputError('Run not found.',404);
      return publicRun(result.rows[0]);
    },context.organizationId);
  }
  async listRuns(context,{page,filters={},cursorContext=context}={}) {
    return transaction(this.database,async client => {
      const rows=(await client.query(`SELECT id,state,created_at,outcome->'gate' AS gate,outcome->'summary' AS summary,
        snapshot->'agent'->>'name' AS agent_name,snapshot->'dataset'->>'name' AS dataset_name,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
        FROM (SELECT id,state,created_at,outcome,snapshot FROM agenttrust.runs
        WHERE organization_id=$1 AND project_id=$2
        AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))
        AND ($5::text IS NULL OR state=$5)
        AND ($6::text IS NULL OR coalesce(outcome->'gate'->>'decision','inconclusive')=$6)
        ORDER BY created_at DESC,id DESC LIMIT $7) AS recent
        ORDER BY created_at DESC,id DESC`,[context.organizationId,context.projectId,page?.cursor?.time||null,page?.cursor?.id||null,filters.state||null,filters.decision||null,page?page.limit+1:100])).rows.map(row=>{
          const fallback=incomplete(row.state,'Evaluation has not completed.');
          return {id:row.id,state:row.state,createdAt:row.created_at.toISOString(),gate:row.gate||fallback.gate,summary:row.summary||fallback.summary,agentName:row.agent_name,datasetName:row.dataset_name,cursor_time:row.cursor_time};
        });
      return page?pageResult(rows,page,cursorContext):rows.map(({cursor_time,...row})=>row);
    },context.organizationId);
  }
  async cancel(context,id) {
    requireWrite(context); uuid(id);
    return transaction(this.database,async client => {
      const result=await client.query('SELECT * FROM agenttrust.runs WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE',[id,context.organizationId,context.projectId]);
      await revalidateSession(client,context,{write:true});
      if(!result.rowCount) throw new InputError('Run not found.',404);
      const row=result.rows[0];
      if(!terminalStates.has(row.state)) await finalize(client,row,incomplete('cancelled','Evaluation was cancelled.'),context);
      return publicRun((await client.query('SELECT * FROM agenttrust.runs WHERE id=$1',[id])).rows[0]);
    },context.organizationId);
  }
  async auditEvents(context,{action=null,cursorContext=context,page}={}) {
    requireWrite(context,true);
    return transaction(this.database,async client=>{
      const rows=(await client.query(`SELECT id,actor_id,action,resource_id,detail,created_at,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
        FROM agenttrust.audit_events WHERE organization_id=$1
        AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
        AND ($4::text IS NULL OR action=$4) ORDER BY created_at DESC,id DESC LIMIT $5`,
        [context.organizationId,page?.cursor?.time||null,page?.cursor?.id||null,action,page?page.limit+1:100])).rows;
      return page?pageResult(rows,page,cursorContext):rows.map(({cursor_time,...row})=>row);
    },context.organizationId);
  }
  async usage(context) {
    return transaction(this.database,async client => (await client.query('SELECT count(*)::int AS completed_runs,coalesce(sum(evaluated_cases),0)::int AS evaluated_cases,coalesce(sum(attempts),0)::int AS attempts FROM agenttrust.usage_events WHERE organization_id=$1',[context.organizationId])).rows[0],context.organizationId);
  }
}
