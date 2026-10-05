import assert from 'node:assert/strict';
import {assertDemoReceiptBinding} from './demo-receipt-binding.mjs';
import {ensureDemoReviewPolicy} from './demo-policy-version.mjs';

export async function runRoleScenario({call,wait,verify,onStep=()=>{}}){
  const report={schemaVersion:1,synthetic:true,serverDeployed:false,steps:[]};
  let run,input,approvalAttempted=false,rejected=false;
  const step=(name,data)=>{const entry={name,...data};report.steps.push(entry);onStep(entry);};
  const denied=async(name,role,path,data,status=403)=>{await call(role,path,data,status);step(name,{role,httpStatus:status});};
  const check=async(name,allowed,status)=>{
    const request={candidateRunId:run.id,...input};
    const receipt=await call('viewer','/v1/release-gate',request);
    assert.equal(receipt.deploymentAllowed,allowed);assert.equal(receipt.manualApproval?.status,status);
    assert.equal(verify(receipt).signatureVerified,true);
    assertDemoReceiptBinding(receipt,request,run);
    step(name,{role:'viewer',runId:run.id,deploymentAllowed:allowed,manualApproval:status,receiptId:receipt.artifact.receiptId,signatureVerified:true});
  };
  try{
    const catalog=await call('admin','/v1/catalog');
    const agent=catalog.agent.find(v=>v.mode==='compliant'),dataset=catalog.dataset.find(v=>v.name==='Customer support safety · v1');assert.ok(agent&&dataset);
    const policy=await ensureDemoReviewPolicy({call:(path,data)=>call('admin',path,data),policies:catalog.policy,name:'Portfolio synthetic role boundaries'});
    report.demoPolicyReused=policy.reused;report.demoPolicyVersionId=policy.id;
    input={agentVersionId:agent.id,datasetVersionId:dataset.id,policyVersionId:policy.id};
    run=await call('editor','/v1/runs',{...input,timeoutMs:30000,caseBudget:100});
    const completed=await wait(run.id);assert.equal(completed.id,run.id);
    for(const key of ['agentVersionId','datasetVersionId','policyVersionId'])assert.equal(completed[key],input[key]);
    assert.equal(completed.state,'succeeded');assert.equal(completed.gate.evaluationPassed,true);assert.equal(completed.gate.deploymentAllowed,false);
    run=completed;
    step('editor_evaluation',{role:'editor',runId:run.id,state:run.state,decision:run.gate.decision});
    const viewed=await call('viewer','/v1/runs/'+run.id);assert.equal(viewed.id,run.id);assert.equal(viewed.snapshotHash,run.snapshotHash);
    step('viewer_evidence',{role:'viewer',runId:run.id,httpStatus:200});
    await denied('viewer_cannot_create','viewer','/v1/runs',input);
    await denied('editor_cannot_change_policy','editor','/v1/policy-versions',{name:'Synthetic denied policy',minimumPassRate:1});
    for(const role of ['editor','viewer'])await denied(role+'_cannot_approve',role,'/v1/runs/'+run.id+'/reviews',{decision:'approved',comment:'Synthetic denied review attempt.'});
    await denied('other_organization_cannot_read','outsider','/v1/runs/'+run.id,undefined,404);
    await denied('other_organization_cannot_check','outsider','/v1/release-gate',{candidateRunId:run.id,...input},404);
    const reviews=await call('viewer','/v1/runs/'+run.id+'/reviews');assert.deepEqual(reviews,[]);
    await check('viewer_sees_approval_required',false,'missing');
    approvalAttempted=true;
    await call('admin','/v1/runs/'+run.id+'/reviews',{decision:'approved',comment:'Synthetic role demonstration: administrator review.'});
    await check('viewer_sees_admin_approval',true,'approved');
    await call('admin','/v1/runs/'+run.id+'/reviews',{decision:'rejected',comment:'Synthetic role demonstration finished. Keep this example blocked.'});rejected=true;
    await check('viewer_sees_admin_rejection',false,'rejected');
    report.completed=true;
  }catch{report.completed=false;report.failed=true;}
  finally{
    report.cleanupSucceeded=true;
    if(run&&['queued','running'].includes(run.state))try{await call('editor','/v1/runs/'+run.id+'/cancel',{});}catch{report.cleanupSucceeded=false;}
    if(run&&approvalAttempted&&!rejected)try{await call('admin','/v1/runs/'+run.id+'/reviews',{decision:'rejected',comment:'Synthetic role cleanup: keep this example blocked.'});}catch{report.cleanupSucceeded=false;}
  }
  return report;
}
