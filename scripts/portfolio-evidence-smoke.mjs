import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
try{
  assert.equal(process.argv.length,2);
  const {stdout}=await exec(process.execPath,['scripts/portfolio-demo.mjs','--compare','--export-receipts'],{timeout:120000,maxBuffer:65536,windowsHide:true});
  const report=JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(report.status,'passed');assert.equal(report.steps,12);assert.equal(report.withBaselineComparison,true);
  const {directory,manifestSha256}=report.evidenceBundle;
  assert.match(directory,/^\.local[/\\]portfolio-evidence-[a-f0-9-]{36}$/);assert.match(manifestSha256,/^[a-f0-9]{64}$/);
  const result=await exec(process.execPath,['scripts/verify-portfolio-evidence.mjs',directory,'.local/receipt-signing/public.pem',manifestSha256],{timeout:30000,maxBuffer:65536,windowsHide:true});
  const verification=JSON.parse(result.stdout.trim());
  assert.equal(verification.bundleVerified,true);assert.equal(verification.manifestDigestIndependentlyExpected,true);
  console.log(JSON.stringify({status:'passed',directory,manifestSha256,...verification}));
}catch{
  console.error('Synthetic portfolio evidence export or offline verification did not complete.');process.exitCode=1;
}
