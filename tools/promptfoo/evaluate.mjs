import {evaluate} from 'promptfoo';
import assert from 'node:assert/strict';
const cases=[['pass','succeeded','pass','pass'],['block','succeeded','block','fail'],['missing_evidence','succeeded','inconclusive','inconclusive'],['error','failed','inconclusive','inconclusive']];
function check(output,context){
 try{const value=JSON.parse(output),vars=context.vars;return value.executionEngine==='python-synthetic'&&value.state===vars.state&&value.decision===vars.decision&&Array.isArray(value.rules)&&value.rules.length===1&&value.rules[0].id==='required-output'&&value.rules[0].required===true&&value.rules[0].status===vars.status&&typeof value.rules[0].reason==='string'&&value.rules[0].reason.length>0&&value.rules[0].reason.length<=500;}
 catch{return false}
}
try{
 const result=await evaluate({description:'Fixed synthetic Python evaluation contract; no external model or deployment authority',prompts:['{{scenario}}'],providers:['file://./worker-provider.mjs'],tests:cases.map(([scenario,state,decision,status])=>({vars:{scenario,state,decision,status},assert:[{type:'is-json'},{type:'javascript',value:check}]}))},{cache:false,sharing:false,writeLatestResults:false,maxConcurrency:1});
 const summary=await result.toEvaluateSummary();assert.equal(summary.results.length,4);assert.equal(summary.stats.successes,4);assert.equal(summary.stats.failures,0);assert.ok(summary.results.every(row=>row.success&&row.response?.metadata?.scopeVerified===true));
 console.log(JSON.stringify({completed:true,engine:'promptfoo',version:'0.124.1',provider:'python-fastapi',cases:4,assertions:8,synthetic:true,externalProviderCalled:false,deploymentAuthority:false,rawSecretsPrinted:false}));
}catch{console.log(JSON.stringify({completed:false,code:'PROMPTFOO_WORKER_CONTRACT_UNVERIFIED',rawSecretsPrinted:false}));process.exitCode=1}
