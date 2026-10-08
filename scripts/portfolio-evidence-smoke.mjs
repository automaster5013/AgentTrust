import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {loadPortfolioEvidence,writePortfolioEvidence} from './portfolio-evidence.mjs';
import {verifyPortfolioReceiptHistory} from './portfolio-receipt-history.mjs';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {parseDemoOptions} from './demo-options.mjs';
const exec=promisify(execFile);
let cookie,base,scope;
async function call(path,data){
 const response=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':scope.projectId,...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
 if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
 if(!response.ok){await response.body?.cancel();throw Error('Local evidence history request failed');}return readReleaseResponse(response);
}
try{
  const options=parseDemoOptions(process.argv.slice(2),['--with-reviews','--with-report']),withReviews=options['--with-reviews']===true,withReport=options['--with-report']===true;assert.ok(!withReport||withReviews);
  const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,'')),organization=config.organizations?.[options.organizationIndex];scope=seededDemoScope(organization);
  const {stdout}=await exec(process.execPath,['scripts/portfolio-demo.mjs','--compare','--export-receipts','--organization-index',String(options.organizationIndex)],{timeout:120000,maxBuffer:65536,windowsHide:true});
  const report=JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(report.status,'passed');assert.equal(report.steps,12);assert.equal(report.withBaselineComparison,true);
  let {directory,manifestSha256}=report.evidenceBundle;
  assert.match(directory,/^\.local[/\\]portfolio-evidence-[a-f0-9-]{36}$/);assert.match(manifestSha256,/^[a-f0-9]{64}$/);
  const result=await exec(process.execPath,['scripts/verify-portfolio-evidence.mjs',directory,'.local/receipt-signing/public.pem',manifestSha256],{timeout:30000,maxBuffer:65536,windowsHide:true});
  const verification=JSON.parse(result.stdout.trim());
  assert.equal(verification.bundleVerified,true);assert.equal(verification.expectedManifestDigestMatched,true);
  const publicKey=await readTrustedReceiptKey('.local/receipt-signing/public.pem');
  const loaded=await loadPortfolioEvidence(directory,publicKey,manifestSha256);
  assert.equal(loaded.manifest.organizationId,scope.organizationId);assert.equal(loaded.manifest.projectId,scope.projectId);base=localSmokeBase();
  await call('/v1/auth/login',{accessKey:organization.credentials.find(credential=>credential.role==='viewer').token});assertDemoSessionScope(await call('/v1/me'),scope,'viewer');
  let reviews;
  const history=await verifyPortfolioReceiptHistory({call,receipts:loaded.receipts,onVerifiedReviews:values=>{reviews=values;}});assert.equal(history.linkedReviewsVerified,2);
  await call('/v1/auth/logout',{});cookie=null;
  let finalVerification=verification;
  let linkedOpinionCliChecks=0,packagedLinkedOpinionCliChecks=0;
  if(withReviews){
    const enriched=await writePortfolioEvidence({receipts:loaded.receipts,reviews,trustedPem:publicKey,report:{...report,completed:true,steps:loaded.manifest.receipts.map(row=>({name:row.step,receiptId:row.receiptId,runId:row.candidateRunId,...(row.baselineRunId?{baselineRunId:row.baselineRunId}:{})}))}});
    directory=enriched.directory;manifestSha256=enriched.manifestSha256;
    const result=await exec(process.execPath,['scripts/verify-portfolio-evidence.mjs',directory,'.local/receipt-signing/public.pem',manifestSha256],{timeout:30000,maxBuffer:65536,windowsHide:true});finalVerification=JSON.parse(result.stdout.trim());assert.equal(finalVerification.reviewBodiesVerifiedOffline,true);
    const bundle=await loadPortfolioEvidence(directory,publicKey,manifestSha256);
    for(const [index,receipt] of bundle.receipts.entries()){
      const reviewIndex=bundle.reviews.findIndex(review=>review.id===receipt.artifact.result.manualApproval?.reviewId);
      if(reviewIndex<0)continue;
      const receiptFile=join(directory,`receipt-${index+1}.json`),reviewFile=join(directory,`review-${reviewIndex+1}.json`);
      const selected=['--organization-id',scope.organizationId,'--project-id',scope.projectId,'--candidate-run-id',receipt.artifact.request.candidateRunId,'--baseline-run-id',receipt.artifact.request.baselineRunId];
      const result=await exec(process.execPath,['scripts/inspect-receipt.mjs',receiptFile,'.local/receipt-signing/public.pem',...selected,'--review-file',reviewFile],{timeout:30000,maxBuffer:10000,windowsHide:true});
      const inspected=JSON.parse(result.stdout);assert.equal(inspected.reviewBodyVerified,true);assert.equal(inspected.linkedReviewId,bundle.reviews[reviewIndex].id);assert.equal(inspected.deploymentAllowed,false);assert.equal(inspected.currentReviewerAuthorityVerified,false);linkedOpinionCliChecks++;
      if(process.env.AGENTTRUST_IMAGE){
        assert.match(process.env.AGENTTRUST_IMAGE,/^ghcr\.io\/automaster5013\/agenttrust@sha256:[a-f0-9]{64}$/);
        const image=await exec('docker',['run','--rm','--user',`${process.getuid()}:${process.getgid()}`,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${resolve(receiptFile)},target=/receipt.json,readonly`,'--mount',`type=bind,source=${resolve(reviewFile)},target=/review.json,readonly`,'--mount',`type=bind,source=${resolve('.local/receipt-signing/public.pem')},target=/trusted.pem,readonly`,'--entrypoint','node',process.env.AGENTTRUST_IMAGE,'scripts/inspect-receipt.mjs','/receipt.json','/trusted.pem',...selected,'--review-file','/review.json'],{timeout:30000,maxBuffer:10000,windowsHide:true});
        assert.deepEqual(JSON.parse(image.stdout),inspected);packagedLinkedOpinionCliChecks++;
      }
    }
    assert.equal(linkedOpinionCliChecks,2);if(process.env.AGENTTRUST_IMAGE)assert.equal(packagedLinkedOpinionCliChecks,2);
  }
  let auditReport;
  if(withReport){
    const path='.local/portfolio-audit-'+randomUUID()+'.html';
    const result=await exec(process.execPath,['scripts/write-portfolio-evidence-report.mjs',directory,'.local/receipt-signing/public.pem',path,manifestSha256],{timeout:30000,maxBuffer:65536,windowsHide:true}),written=JSON.parse(result.stdout.trim());assert.equal(written.reportCreated,true);assert.equal(written.reportCryptographicallySigned,false);auditReport={path,reportCreated:true,reportCryptographicallySigned:false};
  }
  console.log(JSON.stringify({status:'passed',organizationIndex:options.organizationIndex,...scope,directory,...finalVerification,...history,linkedOpinionCliChecks,packagedLinkedOpinionCliChecks,...(auditReport?{auditReport}:{}),historySessionLoggedOut:true}));
}catch{
  console.error('Synthetic portfolio evidence export, offline verification or history check did not complete.');process.exitCode=1;
}

finally{if(cookie)try{await call('/v1/auth/logout',{});cookie=null;}catch{console.error('Synthetic evidence history session cleanup did not complete.');process.exitCode=1;}}
