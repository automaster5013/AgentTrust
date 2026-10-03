import { randomUUID } from 'node:crypto';
import { validate, InputError } from '../../packages/contracts/index.js';
import { hash } from '../../packages/contracts/hash.js';
import { transaction } from './database.js';
import { audit, requireWrite } from './auth.js';

export const terminalStates = new Set(['succeeded','failed','cancelled','timed_out']);
export const incomplete = (state, reason) => ({ state, results:[], summary:{cases:0,rules:0,pass:0,fail:0,inconclusive:0,passRate:0}, gate:{ decision:'inconclusive',deploymentAllowed:false,reason } });
function uuid(value) { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '')) throw new InputError('Invalid resource id.'); return value; }
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
  await client.query('INSERT INTO agenttrust.usage_events(organization_id,run_id,attempts,evaluated_cases) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[row.organization_id,row.id,row.attempts,outcome.results.length]);
  await audit(client,{...context,organizationId:row.organization_id},`run.${outcome.state}`,row.id,{attempts:row.attempts,gate:outcome.gate.decision});
}
export class PgStore {
  constructor(database) { this.database=database; }
  async catalog(context) {
    return transaction(this.database, async client => {
      const rows = (await client.query('SELECT * FROM agenttrust.versions WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at,id',[context.organizationId,context.projectId])).rows;
      const result={agent:[],dataset:[],policy:[]};
      for(const row of rows) result[row.kind].push({id:row.id,name:row.data.name,contentHash:row.content_hash,mode:row.data.mode,cases:row.data.cases?.length});
      return result;
    },context.organizationId);
  }
  async createVersion(context,kind,input) {
    requireWrite(context,kind==='policy'); const data=validate(kind,input);
    return transaction(this.database,async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[context.organizationId]);
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
      const previous=await client.query('SELECT * FROM agenttrust.runs WHERE organization_id=$1 AND project_id=$2 AND idempotency_key=$3',[context.organizationId,context.projectId,key]);
      if(previous.rowCount) {
        if(previous.rows[0].fingerprint!==fingerprint) throw new InputError('Idempotency key conflicts with another request.',409);
        return {run:publicRun(previous.rows[0]),replay:true};
      }
      const count=await client.query("SELECT count(*) AS total,count(*) FILTER(WHERE state IN ('queued','running')) AS active FROM agenttrust.runs WHERE organization_id=$1",[context.organizationId]);
      if(Number(count.rows[0].total)>=10000||Number(count.rows[0].active)>=10) throw new InputError('Organization execution quota reached.',429);
      const snapshot={};
      for(const kind of ['agent','dataset','policy']) {
        const result=await client.query('SELECT * FROM agenttrust.versions WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND kind=$4',[request[`${kind}VersionId`],context.organizationId,context.projectId,kind]);
        if(!result.rowCount) throw new InputError(`Unknown ${kind} version.`,404);
        const v=result.rows[0]; snapshot[kind]={...v.data,id:v.id,contentHash:v.content_hash,createdAt:v.created_at.toISOString()};
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
  async listRuns(context) {
    return transaction(this.database,async client => (await client.query('SELECT * FROM agenttrust.runs WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100',[context.organizationId,context.projectId])).rows.map(row => {
      const run=publicRun(row); return {id:run.id,state:run.state,createdAt:run.createdAt,gate:run.gate,summary:run.summary,agentName:run.snapshot.agent.name,datasetName:run.snapshot.dataset.name};
    }),context.organizationId);
  }
  async cancel(context,id) {
    requireWrite(context); uuid(id);
    return transaction(this.database,async client => {
      const result=await client.query('SELECT * FROM agenttrust.runs WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE',[id,context.organizationId,context.projectId]);
      if(!result.rowCount) throw new InputError('Run not found.',404);
      const row=result.rows[0];
      if(!terminalStates.has(row.state)) await finalize(client,row,incomplete('cancelled','Evaluation was cancelled.'),context);
      return publicRun((await client.query('SELECT * FROM agenttrust.runs WHERE id=$1',[id])).rows[0]);
    },context.organizationId);
  }
  async auditEvents(context) {
    requireWrite(context,true);
    return transaction(this.database, async client => (await client.query('SELECT id,actor_id,action,resource_id,detail,created_at FROM agenttrust.audit_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',[context.organizationId])).rows,context.organizationId);
  }
  async usage(context) {
    return transaction(this.database,async client => (await client.query('SELECT count(*)::int AS completed_runs,coalesce(sum(evaluated_cases),0)::int AS evaluated_cases,coalesce(sum(attempts),0)::int AS attempts FROM agenttrust.usage_events WHERE organization_id=$1',[context.organizationId])).rows[0],context.organizationId);
  }
}
