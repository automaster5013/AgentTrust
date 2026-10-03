import { hash } from '../../packages/contracts/hash.js';
import { incomplete } from '../../packages/evaluator/outcome.js';
import { recordCompletion } from '../api/pg-store.js';

export async function finalizeClaim(client,row,outcome){
  const expired=incomplete('timed_out','Evaluation exceeded its time budget.');
  const result=await client.query(`WITH timing AS MATERIALIZED (SELECT clock_timestamp() AS now)
    UPDATE agenttrust.runs r SET state=CASE WHEN r.deadline<=t.now THEN 'timed_out' ELSE $2 END,
      outcome=CASE WHEN r.deadline<=t.now THEN $3::jsonb ELSE $4::jsonb END,
      result_hash=CASE WHEN r.deadline<=t.now THEN $5 ELSE $6 END,completed_at=t.now,lease_token=NULL,lease_until=NULL
    FROM timing t WHERE r.id=$1 AND r.state='running' AND r.lease_token=$7 AND r.lease_until>t.now
    RETURNING r.outcome`,[row.id,outcome.state,expired,outcome,hash({results:expired.results,gate:expired.gate}),hash({results:outcome.results,gate:outcome.gate}),row.lease_token]);
  if(!result.rowCount)return false;
  await recordCompletion(client,row,result.rows[0].outcome);return true;
}
