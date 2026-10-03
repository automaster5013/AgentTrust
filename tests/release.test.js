import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { compareRuns,releaseGate } from '../packages/evaluator/comparison.js';
import { publicIPv4,resolveTarget,httpsEvidence } from '../packages/evaluator/https-adapter.js';
import { evaluate,evaluateAsync } from '../packages/evaluator/index.js';
import { validate } from '../packages/contracts/index.js';
import { hash } from '../packages/contracts/hash.js';
import { sampleDataset } from '../packages/contracts/samples.js';

const snapshot={agent:{id:'a',mode:'compliant'},dataset:{...sampleDataset,contentHash:'dataset'},policy:{minimumPassRate:1,contentHash:'policy'}};
function run(mode='compliant') {
  const s=structuredClone(snapshot);s.agent.mode=mode;
  const outcome=evaluate(s);
  return {id:mode,organizationId:'o',projectId:'p',agentVersionId:'a',datasetVersionId:'d',policyVersionId:'p',snapshot:s,snapshotHash:hash(s),...outcome,resultHash:hash({results:outcome.results,gate:outcome.gate}),completedAt:new Date().toISOString()};
}
const expected={agentVersionId:'a',datasetVersionId:'d',policyVersionId:'p'};
test('comparison identifies regressions and rejects mismatched or incomplete evidence',()=>{
  assert.equal(compareRuns(run(),run()).deploymentAllowed,true);
  assert.ok(compareRuns(run(),run('regression')).regressions.length>0);
  assert.equal(compareRuns(run(),run('missing_evidence')).comparable,false);
  const foreign=run();foreign.organizationId='foreign';assert.throws(()=>compareRuns(run(),foreign));
  const changed=run();changed.snapshot.policy.contentHash='other';assert.throws(()=>compareRuns(run(),changed));
});
test('CI gate fails closed on stale, incorrect versions, tampered results and nonpassing states',()=>{
  assert.equal(releaseGate(run(),expected).deploymentAllowed,true);
  assert.equal(releaseGate(run(),{...expected,agentVersionId:'other'}).deploymentAllowed,false);
  assert.equal(releaseGate(run(),{}).deploymentAllowed,false);
  const stale=run();stale.completedAt=new Date(Date.now()-601000).toISOString();assert.equal(releaseGate(stale,expected).deploymentAllowed,false);
  const future=run();future.completedAt=new Date(Date.now()+10000).toISOString();assert.equal(releaseGate(future,expected).deploymentAllowed,false);
  const partial=run();partial.results[0].rules=[];partial.resultHash=hash({results:partial.results,gate:partial.gate});assert.equal(releaseGate(partial,expected).deploymentAllowed,false);
  const tampered=run();tampered.results[0].evidence.output='tampered';assert.equal(releaseGate(tampered,expected).deploymentAllowed,false);
  for(const mode of ['error','regression','missing_evidence'])assert.equal(releaseGate(run(mode),expected).deploymentAllowed,false);
  assert.throws(()=>releaseGate(run(),{...expected,maxAgeSeconds:Infinity}));
  assert.equal(releaseGate(run(),expected,run('missing_evidence')).deploymentAllowed,false);
});
test('HTTPS contract requires a connection ID and rejects injected endpoint fields',()=>{
  assert.equal(evaluate({...snapshot,agent:{mode:'https'}}).gate.decision,'inconclusive');
  assert.throws(()=>validate('agent',{name:'x',mode:'https'}));
  assert.throws(()=>validate('agent',{name:'x',mode:'https',connectorId:'x',endpointHash:'a'.repeat(64),url:'https://example.com'}));
  assert.equal(validate('agent',{name:'x',mode:'https',connectorId:'x',endpointHash:'a'.repeat(64)}).connectorId,'x');
});
test('egress rejects private, metadata, special-use, IPv6, redirects and mixed DNS destinations',async()=>{
  for(const ip of ['127.0.0.1','10.1.1.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','198.18.0.1','203.0.113.1','224.0.0.1','::1','::ffff:8.8.8.8'])assert.equal(publicIPv4(ip),false,ip);
  const publicDNS=async()=>[{address:'8.8.8.8',family:4}];
  for(const endpoint of ['http://example.com','https://127.0.0.1','https://example.com:8443','https://user:pass@example.com','https://example.com/?secret=x'])await assert.rejects(resolveTarget(endpoint,publicDNS));
  await assert.rejects(resolveTarget('https://example.com',async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]));
  assert.equal((await resolveTarget('https://example.com/evaluate',publicDNS)).address,'8.8.8.8');
});
function transport(response,inspect=()=>{}) {
  return (url,options,callback)=>{
    inspect(url,options);const req=new EventEmitter();
    req.destroy=error=>{if(error)req.emit('error',error);req.emit('close');};
    req.end=payload=>queueMicrotask(()=>{
      assert.ok(!payload.includes('mock'));const res=new EventEmitter();res.statusCode=response.status??200;res.headers={'content-type':'application/json'};res.destroy=()=>{};
      callback(res);if(res.statusCode===200){res.emit('data',Buffer.from(response.body));res.emit('end');req.emit('close');}
    });return req;
  };
}
test('HTTPS adapter is disabled by default, pins approved DNS, enforces TLS and rejects malformed evidence',async()=>{
  await assert.rejects(httpsEvidence(snapshot,sampleDataset.cases[0],{configuration:'{}',organizationId:'o'}));
  const s={...snapshot,agent:{...snapshot.agent,connectorId:'approved',endpointHash:createHash('sha256').update('https://example.com/evaluate').digest('hex')}};
  const options={configuration:JSON.stringify({o:{approved:'https://example.com/evaluate'}}),organizationId:'o',resolver:async()=>[{address:'8.8.8.8',family:4}]};
  const evidence=sampleDataset.cases[0].mock;
  const value=await httpsEvidence(s,sampleDataset.cases[0],{...options,transport:transport({body:JSON.stringify(evidence)},(_u,o)=>{
    assert.equal(o.rejectUnauthorized,true);assert.equal(o.servername,'example.com');assert.equal(o.agent,false);
    o.lookup('example.com',{},(_e,address)=>assert.equal(address,'8.8.8.8'));
  })});assert.deepEqual(value,evidence);
  for(const response of [{status:302},{body:'{}'},{body:'x'.repeat(65537)}])await assert.rejects(httpsEvidence(s,sampleDataset.cases[0],{...options,transport:transport(response)}));
  await assert.rejects(httpsEvidence(s,sampleDataset.cases[0],{...options,organizationId:'other'}));
  await assert.rejects(httpsEvidence(s,sampleDataset.cases[0],{...options,configuration:JSON.stringify({o:{approved:'https://changed.example.com/evaluate'}})}));
});
test('asynchronous external adapter errors never permit a release',async()=>{
  const result=await evaluateAsync(snapshot,async()=>{throw new Error('secret error');});
  assert.equal(result.gate.decision,'inconclusive');assert.equal(result.gate.deploymentAllowed,false);assert.ok(!JSON.stringify(result).includes('secret error'));
});


test('manual approval policies keep automatic passes blocked until valid bound approval exists',()=>{
  const base=run(),s={...base.snapshot,policy:{...base.snapshot.policy,requiresManualApproval:true,manualApprovalTtlSeconds:60}},outcome=evaluate(s),now=Date.now();
  const candidate={...base,...outcome,snapshot:s,snapshotHash:hash(s),resultHash:hash({results:outcome.results,gate:outcome.gate}),completedAt:new Date(now).toISOString()};
  assert.equal(candidate.gate.decision,'pass');assert.equal(candidate.gate.deploymentAllowed,false);assert.equal(candidate.gate.evaluationPassed,true);
  assert.equal(compareRuns(candidate,candidate).deploymentAllowed,false);assert.equal(compareRuns(candidate,candidate).evaluationPassed,true);
  assert.equal(releaseGate(candidate,expected,undefined,now).manualApproval.status,'missing');
  const payload={schemaVersion:1,id:'review',organizationId:candidate.organizationId,projectId:candidate.projectId,runId:candidate.id,actorId:'admin',decision:'approved',comment:'Synthetic evidence reviewed',createdAt:new Date(now).toISOString(),snapshotHash:candidate.snapshotHash,resultHash:candidate.resultHash};
  const review={...payload,reviewHash:hash(payload),actorValid:true};assert.equal(releaseGate(candidate,expected,undefined,now,review).deploymentAllowed,true);
  assert.equal(releaseGate(candidate,expected,undefined,now+61000,review).manualApproval.status,'expired');
  for(const changed of [{...payload,projectId:'foreign'},{...payload,resultHash:'changed'},{...payload,createdAt:new Date(now+1000).toISOString()}])assert.equal(releaseGate(candidate,expected,undefined,now,{...changed,reviewHash:hash(changed),actorValid:true}).deploymentAllowed,false);
  assert.equal(releaseGate(candidate,expected,undefined,now,{...review,actorValid:false}).manualApproval.status,'invalid');
  assert.equal(releaseGate(candidate,expected,undefined,now,{...review,comment:'tampered'}).manualApproval.status,'invalid');
  const rejected={...payload,decision:'rejected'};assert.equal(releaseGate(candidate,expected,undefined,now,{...rejected,reviewHash:hash(rejected),actorValid:true}).manualApproval.status,'rejected');
  assert.equal(releaseGate(candidate,{...expected,agentVersionId:'wrong'},undefined,now,review).deploymentAllowed,false);
  for(const policy of [{name:'Bad',minimumPassRate:1,manualApprovalTtlSeconds:60},{name:'Bad',minimumPassRate:1,requiresManualApproval:true,manualApprovalTtlSeconds:59},{name:'Bad',minimumPassRate:1,requiresManualApproval:'yes'}])assert.throws(()=>validate('policy',policy));
});
