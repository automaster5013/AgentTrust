import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,''));
const accessKey=config.organizations[0].credentials.find(c=>c.role==='admin').token;
const base=`http://127.0.0.1:${process.env.PORT || 4310}`;
let cookie;
async function request(path,{method='GET',data,key}={}) {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui',...(cookie?{Cookie:cookie}:{}),...(key?{'Idempotency-Key':key}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!response.ok)throw new Error(`Smoke request failed (${response.status}).`);return response.json();
}
await request('/v1/auth/login',{method:'POST',data:{accessKey}});
try {
  if(process.argv[2]==='before') {
    const catalog=await request('/v1/catalog');
    let run=await request('/v1/runs',{method:'POST',key:randomUUID(),data:{agentVersionId:catalog.agent.find(a=>a.mode==='compliant').id,datasetVersionId:catalog.dataset[0].id,policyVersionId:catalog.policy[0].id}});
    for(let i=0;i<100&&['queued','running'].includes(run.state);i++){await new Promise(resolve=>setTimeout(resolve,100));run=await request(`/v1/runs/${run.id}`);}
    assert.equal(run.gate.decision,'pass');
    await writeFile('.local/restart-check.json',JSON.stringify({id:run.id,snapshotHash:run.snapshotHash,resultHash:run.resultHash,usage:await request('/v1/usage')},null,2)+'\n');
    console.log('Docker smoke: authenticated API -> durable queue -> independent worker -> PASS. Restart checkpoint saved.');
  } else if(process.argv[2]==='after') {
    const checkpoint=JSON.parse(await readFile('.local/restart-check.json','utf8'));const run=await request(`/v1/runs/${checkpoint.id}`);
    assert.equal(run.state,'succeeded');assert.equal(run.snapshotHash,checkpoint.snapshotHash);assert.equal(run.resultHash,checkpoint.resultHash);
    assert.deepEqual(await request('/v1/usage'),checkpoint.usage);
    const audit=await request('/v1/audit-events');assert.equal(audit.filter(e=>e.resource_id===run.id&&e.action==='run.succeeded').length,1);
    console.log('Docker restart smoke: persisted evidence and hashes unchanged; usage and completion audit were not duplicated.');
  } else throw new Error('Specify before or after.');
} finally { await request('/v1/auth/logout',{method:'POST',data:{}}); }
