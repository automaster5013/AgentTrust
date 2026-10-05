import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {hash} from '../packages/contracts/hash.js';
import {evaluate} from '../packages/evaluator/index.js';
import {ReceiptSigner,verifyReceipt} from '../packages/receipts/signature.js';
import {acceptanceModes,validateAcceptanceProfile,ensureAcceptanceVersion} from '../scripts/acceptance-profile.mjs';
import {runAcceptanceScenario} from '../scripts/acceptance-scenario.mjs';
import {parseAcceptanceOptions} from '../scripts/acceptance-demo.mjs';
async function profile(){return JSON.parse(await readFile(new URL('../examples/connector-contract/acceptance-profile.json',import.meta.url),'utf8'));}
test('acceptance profile distinguishes all five synthetic outcomes and mandates full evaluation with manual approval',async()=>{
 const p=await profile(),before=JSON.stringify(p);assert.deepEqual(validateAcceptanceProfile(p),p);assert.equal(JSON.stringify(p),before);
 for(const change of [p=>p.synthetic=false,p=>p.extra='private-canary',p=>p.policy.minimumPassRate=0.8,p=>p.policy.requiresManualApproval=false,p=>p.dataset.cases[0].mock.output='Bad synthetic baseline',p=>{for(const c of p.dataset.cases)c.rules=c.rules.filter(r=>r.type!=='allowed_tools');}]){const changed=structuredClone(p);change(changed);assert.throws(()=>validateAcceptanceProfile(changed));}
});
test('exact immutable acceptance versions are reused and same-name different criteria are created separately',async()=>{
 const p=await profile();for(const kind of ['dataset','policy']){const data=p[kind],id=randomUUID(),version={id,kind,data,contentHash:hash(data)},calls=[];const call=async(path,body)=>{calls.push({path,body});return body?{...body,id,contentHash:hash(body)}:version;};let r=await ensureAcceptanceVersion({call,catalog:[{id,name:data.name,contentHash:hash(data)}],kind,data});assert.equal(r.reused,true);assert.equal(calls.length,1);calls.length=0;r=await ensureAcceptanceVersion({call,catalog:[{id,name:data.name,contentHash:'0'.repeat(64)}],kind,data});assert.equal(r.reused,false);assert.equal(calls[0].path,'/v1/'+kind+'-versions');assert.equal(calls.length,2);}
});
test('claimed acceptance-version hashes cannot conceal altered stored declarations or resource identity',async()=>{
 const p=await profile();for(const kind of ['dataset','policy'])for(const mutate of [v=>v.id=randomUUID(),v=>v.kind='agent',v=>v.contentHash='0'.repeat(64),v=>v.data.name='Altered private criteria']){const id=randomUUID(),data=p[kind],version={id,kind,data:structuredClone(data),contentHash:hash(data)};mutate(version);await assert.rejects(ensureAcceptanceVersion({kind,data,catalog:[{id,name:data.name,contentHash:hash(data)}],call:async(path,body)=>{assert.equal(body,undefined);return version;}}));}
});
async function fixture({changeRun=()=>{},changeReceipt=()=>{},failCheck=0,failWait=false,failReject=false}={}){
 const p=await profile(),scope={organizationId:randomUUID(),projectId:randomUUID()},calls=[],versions=new Map(),runs=new Map(),keys=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(keys.privateKey.export({type:'pkcs8',format:'pem'}));const reviews=new Map();let checks=0;
 const catalog={agent:[],dataset:[],policy:[]};for(const [mode] of acceptanceModes){const id=randomUUID(),data={name:'Synthetic '+mode,mode},row={id,kind:'agent',data,contentHash:hash(data)};versions.set(id,row);catalog.agent.push({id,mode,name:data.name,contentHash:row.contentHash});}
 const call=async(path,body)=>{calls.push({path,body});if(path==='/v1/catalog')return catalog;if(path.startsWith('/v1/versions/'))return structuredClone(versions.get(path.split('/').at(-1)));if(['/v1/dataset-versions','/v1/policy-versions'].includes(path)){const kind=path.includes('dataset')?'dataset':'policy',id=randomUUID(),row={id,kind,data:structuredClone(body),contentHash:hash(body)};versions.set(id,row);catalog[kind].push({id,name:body.name,contentHash:row.contentHash});return {...body,id,contentHash:row.contentHash};}
 if(path==='/v1/runs'){const id=randomUUID(),snapshot={agent:versions.get(body.agentVersionId).data,dataset:versions.get(body.datasetVersionId).data,policy:versions.get(body.policyVersionId).data},outcome=evaluate(snapshot),run={id,...scope,...body,...outcome,snapshotHash:hash(snapshot),resultHash:hash({results:outcome.results,gate:outcome.gate})};runs.set(id,run);return run;}
 if(path.endsWith('/reviews')){if(failReject&&body.decision==='rejected')throw Error('Private rejection error');reviews.set(path.split('/')[3],body.decision);return {};}
 if(path.endsWith('/cancel'))return {};
 if(path==='/v1/release-gate'){if(++checks===failCheck)throw Error('Private release error');const c=runs.get(body.candidateRunId),b=runs.get(body.baselineRunId),review=reviews.get(c.id)||'missing',allowed=c.gate.decision==='pass'&&review==='approved',result={runId:c.id,decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['Synthetic blocked result'],manualApproval:{status:review},comparison:{baselineRunId:b.id,candidateRunId:c.id,comparable:c.gate.decision!=='inconclusive',evaluationPassed:c.gate.decision==='pass',regressions:c.gate.decision==='block'?[{}]:[]}},evidence=Object.fromEntries([['candidate',c],['baseline',b]].map(([name,r])=>[name,{runId:r.id,snapshotHash:r.snapshotHash,resultHash:r.resultHash}])),artifact={receiptId:randomUUID(),...scope,request:structuredClone(body),evidence,result:structuredClone(result)},receipt={...result,artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)};changeReceipt(receipt,checks);return receipt;}
 throw Error('Unexpected acceptance operation');};
 return {calls,profile:p,scope,dependencies:{profile:p,scope,operations:{observedAt:'2026-10-06T00:00:00Z',versionCapacity:{scope:'organization',organizationId:scope.organizationId,used:0,limit:1000,remaining:1000}},call,wait:async id=>{if(failWait)throw Error('Private wait error');const run=structuredClone(runs.get(id));changeRun(run);return run;},verify:receipt=>verifyReceipt(receipt,signer.publicMetadata().publicKey)}};
}
test('acceptance scenario registers custom criteria, evaluates six runs and verifies seven signed comparison decisions',async()=>{
 const f=await fixture(),r=await runAcceptanceScenario(f.dependencies);assert.equal(r.completed,true);assert.equal(r.cleanupSucceeded,true);assert.equal(r.steps.length,13);assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,6);assert.equal(r.steps.filter(s=>s.signatureVerified).length,7);assert.deepEqual(r.steps.filter(s=>s.signatureVerified).map(s=>s.deploymentAllowed),[false,true,false,false,false,false,false]);assert.equal(f.calls.filter(c=>c.path.endsWith('/reviews')).at(-1).body.decision,'rejected');f.dependencies.operations.versionCapacity={scope:'organization',organizationId:f.scope.organizationId,used:1000,limit:1000,remaining:0};const repeated=await runAcceptanceScenario(f.dependencies);assert.equal(repeated.completed,true);assert.equal(repeated.criteria.dataset.reused,true);assert.equal(repeated.criteria.policy.reused,true);assert.equal(f.calls.filter(c=>c.path.endsWith('-versions')).length,2);
});
test('acceptance scenario rejects unrelated runs and cancels only its own pending execution',async()=>{
 for(const changeRun of [r=>r.id=randomUUID(),r=>r.organizationId=randomUUID(),r=>r.projectId=randomUUID(),r=>r.datasetVersionId=randomUUID()]){const f=await fixture({changeRun}),r=await runAcceptanceScenario(f.dependencies);assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.match(f.calls.at(-1).path,/\/cancel$/);}
});
test('invalid signatures or unrelated signed results cannot grant acceptance and post-approval failures are rejected',async()=>{
 for(const changeReceipt of [r=>r.signature.value='invalid',r=>r.artifact.evidence.baseline.resultHash='0'.repeat(64),r=>r.comparison.candidateRunId=randomUUID(),r=>r.artifact.projectId=randomUUID()]){const f=await fixture({changeReceipt}),r=await runAcceptanceScenario(f.dependencies);assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);}
 const f=await fixture({failCheck:2}),r=await runAcceptanceScenario(f.dependencies);assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.equal(f.calls.at(-1).body.decision,'rejected');assert.ok(!JSON.stringify(r).includes('Private'));
});
test('failed acceptance cleanup prevents a success result and unavailable evaluations cancel the pending run',async()=>{
 const f=await fixture({failCheck:2,failReject:true}),r=await runAcceptanceScenario(f.dependencies);assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,false);const waiting=await fixture({failWait:true}),w=await runAcceptanceScenario(waiting.dependencies);assert.equal(w.completed,false);assert.equal(w.cleanupSucceeded,true);assert.match(waiting.calls.at(-1).path,/\/cancel$/);
});
test('ambiguous acceptance CLI options are rejected before authentication',()=>{
 assert.equal(parseAcceptanceOptions([]).organizationIndex,0);assert.equal(parseAcceptanceOptions(['--organization-index','1','--profile','synthetic.json']).organizationIndex,1);for(const args of [['--profile'],['--organization-index','01'],['--organization-index','100'],['--profile','a','--profile','b'],['--unknown','a']])assert.throws(()=>parseAcceptanceOptions(args));
});
