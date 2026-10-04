import assert from 'node:assert/strict';

// The scenario uses only the seeded synthetic dataset and deterministic mocks.
export async function runPortfolioScenario({call,wait,verify,onStep=()=>{}}){
  const report={schemaVersion:1,synthetic:true,serverDeployed:false,steps:[]};
  const active=new Set();let reviewRun,approvalAttempted=false,rejected=false;
  const step=(name,data)=>{const item={name,...data};report.steps.push(item);onStep(item);};
  const check=async(name,run,input,allowed,status)=>{
    const receipt=await call('/v1/release-gate',{candidateRunId:run.id,...input});
    assert.equal(receipt.deploymentAllowed,allowed);
    if(status)assert.equal(receipt.manualApproval?.status,status);
    assert.equal(verify(receipt).signatureVerified,true);
    step(name,{runId:run.id,decision:receipt.decision,deploymentAllowed:allowed,manualApproval:receipt.manualApproval?.status||'not_required',receiptId:receipt.artifact.receiptId,signatureVerified:true});
  };
  try{
    const catalog=await call('/v1/catalog');
    const dataset=catalog.dataset.find(d=>d.name==='Customer support safety · v1');
    const policy=catalog.policy.find(p=>p.name==='필수 검증 전체 통과'&&!p.requiresManualApproval&&p.minimumPassRate===1);
    assert.ok(dataset&&policy,'Seeded synthetic versions required');
    const execute=async(mode,policyVersionId,state,decision)=>{
      const agent=catalog.agent.find(a=>a.mode===mode);assert.ok(agent);
      const input={agentVersionId:agent.id,datasetVersionId:dataset.id,policyVersionId};
      const created=await call('/v1/runs',{...input,timeoutMs:30000,caseBudget:100});active.add(created.id);
      const run=await wait(created.id);assert.equal(run.state,state);assert.equal(run.gate.decision,decision);active.delete(run.id);
      step('evaluation_'+mode,{runId:run.id,state:run.state,decision:run.gate.decision});return {run,input};
    };
    for(const [mode,state,decision,allowed] of [['compliant','succeeded','pass',true],['regression','succeeded','block',false],['missing_evidence','succeeded','inconclusive',false]]){
      const item=await execute(mode,policy.id,state,decision);await check('release_'+mode,item.run,item.input,allowed);
    }
    const manual=await call('/v1/policy-versions',{name:'Portfolio synthetic administrator review',minimumPassRate:1,requiresManualApproval:true,manualApprovalTtlSeconds:3600});
    const item=await execute('compliant',manual.id,'succeeded','pass');reviewRun=item.run;
    assert.equal(reviewRun.gate.evaluationPassed,true);assert.equal(reviewRun.gate.deploymentAllowed,false);
    await check('approval_required',reviewRun,item.input,false,'missing');
    approvalAttempted=true;
    await call('/v1/runs/'+reviewRun.id+'/reviews',{decision:'approved',comment:'Synthetic portfolio demonstration: evaluation evidence reviewed.'});
    await check('approval_valid',reviewRun,item.input,true,'approved');
    await call('/v1/runs/'+reviewRun.id+'/reviews',{decision:'rejected',comment:'Synthetic portfolio demonstration finished. Keep this example blocked.'});rejected=true;
    await check('approval_rejected',reviewRun,item.input,false,'rejected');
    report.completed=true;
  }catch{report.completed=false;report.failed=true;}
  finally{
    report.cleanupSucceeded=true;
    for(const id of active)try{await call('/v1/runs/'+id+'/cancel',{});}catch{report.cleanupSucceeded=false;}
    if(approvalAttempted&&!rejected&&reviewRun)try{await call('/v1/runs/'+reviewRun.id+'/reviews',{decision:'rejected',comment:'Synthetic portfolio cleanup: keep this example blocked.'});}catch{report.cleanupSucceeded=false;}
  }
  return report;
}
