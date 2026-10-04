import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadPortfolioEvidence} from './portfolio-evidence.mjs';
import {verifyPortfolioReceiptHistory} from './portfolio-receipt-history.mjs';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
const exec=promisify(execFile);
let cookie,base,scope;
async function call(path,data){
 const response=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':scope.projectId,...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
 if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
 if(!response.ok){await response.body?.cancel();throw Error('Local evidence history request failed');}return readReleaseResponse(response);
}
try{
  assert.equal(process.argv.length,2);
  const {stdout}=await exec(process.execPath,['scripts/portfolio-demo.mjs','--compare','--export-receipts'],{timeout:120000,maxBuffer:65536,windowsHide:true});
  const report=JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(report.status,'passed');assert.equal(report.steps,12);assert.equal(report.withBaselineComparison,true);
  const {directory,manifestSha256}=report.evidenceBundle;
  assert.match(directory,/^\.local[/\\]portfolio-evidence-[a-f0-9-]{36}$/);assert.match(manifestSha256,/^[a-f0-9]{64}$/);
  const result=await exec(process.execPath,['scripts/verify-portfolio-evidence.mjs',directory,'.local/receipt-signing/public.pem',manifestSha256],{timeout:30000,maxBuffer:65536,windowsHide:true});
  const verification=JSON.parse(result.stdout.trim());
  assert.equal(verification.bundleVerified,true);assert.equal(verification.expectedManifestDigestMatched,true);
  const publicKey=await readTrustedReceiptKey('.local/receipt-signing/public.pem');
  const loaded=await loadPortfolioEvidence(directory,publicKey,manifestSha256);
  const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,'')),organization=config.organizations[0];scope=seededDemoScope(organization);
  assert.equal(loaded.manifest.organizationId,scope.organizationId);assert.equal(loaded.manifest.projectId,scope.projectId);base=localSmokeBase();
  await call('/v1/auth/login',{accessKey:organization.credentials.find(credential=>credential.role==='viewer').token});assertDemoSessionScope(await call('/v1/me'),scope,'viewer');
  const history=await verifyPortfolioReceiptHistory({call,receipts:loaded.receipts});assert.equal(history.linkedReviewsVerified,2);
  await call('/v1/auth/logout',{});cookie=null;
  console.log(JSON.stringify({status:'passed',directory,manifestSha256,...verification,...history,historySessionLoggedOut:true}));
}catch{
  console.error('Synthetic portfolio evidence export, offline verification or history check did not complete.');process.exitCode=1;
}

finally{if(cookie)try{await call('/v1/auth/logout',{});cookie=null;}catch{console.error('Synthetic evidence history session cleanup did not complete.');process.exitCode=1;}}
