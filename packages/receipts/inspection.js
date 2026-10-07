import {verifyReceipt} from './signature.js';
import {hash} from '../contracts/hash.js';

const invalid=()=>{throw new Error('Invalid historical receipt structure.');};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function bounded(value){
 let visited=0;
 function walk(item,depth){
  if(++visited>100000||depth>64)invalid();
  if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return;
  if(!object(item)&&!Array.isArray(item))invalid();
  const keys=Object.keys(item);if(keys.length>100000-visited)invalid();
  for(const key of keys)walk(item[key],depth+1);
 }
 walk(value,0);
}
function comparison(result,candidateId,baselineId,manual){
 if(!object(result)||result.candidateRunId!==candidateId||result.baselineRunId!==baselineId||typeof result.comparable!=='boolean'||typeof result.deploymentAllowed!=='boolean'||!Number.isFinite(result.passRateDelta)||Math.abs(result.passRateDelta)>1||!Array.isArray(result.changes)||!Array.isArray(result.regressions)||result.changes.length>2000||result.regressions.length>2000)invalid();
 const changes=new Map(),statuses=new Set(['pass','fail','inconclusive']);
 for(const change of result.changes){
  if(!object(change)||typeof change.caseId!=='string'||!change.caseId||change.caseId.length>10000||typeof change.ruleId!=='string'||!change.ruleId||change.ruleId.length>10000||!statuses.has(change.before)||!statuses.has(change.after)&&change.after!=='missing'||change.before===change.after||result.comparable&&(change.before==='inconclusive'||!['pass','fail'].includes(change.after)))invalid();
  const key=JSON.stringify([change.caseId,change.ruleId]);if(changes.has(key))invalid();changes.set(key,change);
 }
 const expected=[...changes.values()].filter(change=>change.before==='pass'&&change.after!=='pass'),seen=new Set();
 if(expected.length!==result.regressions.length)invalid();
 for(const regression of result.regressions){
  if(!object(regression))invalid();const key=JSON.stringify([regression.caseId,regression.ruleId]),change=changes.get(key);
  if(seen.has(key)||!change||change.before!=='pass'||change.after==='pass'||regression.before!==change.before||regression.after!==change.after)invalid();seen.add(key);
 }
 const passed=result.evaluationPassed??result.deploymentAllowed;
 if((result.requiresManualApproval===true)!==manual||result.requiresManualApproval!==undefined&&typeof result.requiresManualApproval!=='boolean'||result.evaluationPassed!==undefined&&typeof result.evaluationPassed!=='boolean'||manual&&(typeof result.evaluationPassed!=='boolean'||result.deploymentAllowed)||passed&&(!result.comparable||expected.length)||result.evaluationPassed!==undefined&&result.deploymentAllowed!==(passed&&!manual))invalid();
 return {performed:true,comparable:result.comparable,evaluationPassed:passed,changes:changes.size,regressions:expected.length};
}

// Authentication is necessary but does not establish current policy, evidence or actor authority.
export function normalizeReceiptExpectation(expected){
 if(expected===undefined)return undefined;
 if(!object(expected)||Object.keys(expected).some(key=>!['organizationId','projectId','candidateRunId','baselineRunId'].includes(key))||!uuid(expected.organizationId)||!uuid(expected.projectId)||expected.candidateRunId!==undefined&&!uuid(expected.candidateRunId)||Object.hasOwn(expected,'baselineRunId')&&(!uuid(expected.candidateRunId)||expected.baselineRunId!==null&&!uuid(expected.baselineRunId)))invalid();
 return Object.fromEntries(Object.entries(expected).map(([key,value])=>[key,value===null?null:value.toLowerCase()]));
}
export function inspectHistoricalReceipt(receipt,trustedKey,expectation){
 const expected=normalizeReceiptExpectation(expectation);
 bounded(receipt);const verified=verifyReceipt(receipt,trustedKey),a=receipt.artifact;
 if(!object(a)||a.schemaVersion!==1||!['receiptId','organizationId','projectId'].every(key=>uuid(a[key]))||typeof a.checkedAt!=='string'||a.checkedAt.length>40||!Number.isFinite(Date.parse(a.checkedAt))||!object(a.request)||!object(a.result)||!object(a.evidence))invalid();
 const request=a.request,result=a.result;
 if(!uuid(request.candidateRunId)||request.baselineRunId!==undefined&&!uuid(request.baselineRunId)||result.runId!==request.candidateRunId||!['pass','block'].includes(result.decision)||typeof result.deploymentAllowed!=='boolean'||(result.decision==='pass')!==result.deploymentAllowed||!Array.isArray(result.reasons)||result.reasons.length>64||!result.reasons.every(reason=>typeof reason==='string'&&reason.length<=500)||(result.reasons.length===0)!==result.deploymentAllowed)invalid();
 if(Object.keys(request).some(key=>!['candidateRunId','baselineRunId','agentVersionId','datasetVersionId','policyVersionId','maxAgeSeconds'].includes(key)))invalid();
 for(const key of ['agentVersionId','datasetVersionId','policyVersionId'])if(request[key]!==undefined&&(typeof request[key]!=='string'||request[key].length>80))invalid();
 if(request.maxAgeSeconds!==undefined&&(!Number.isInteger(request.maxAgeSeconds)||request.maxAgeSeconds<1||request.maxAgeSeconds>86400))invalid();
 for(const [name,id] of [['candidate',request.candidateRunId],...(request.baselineRunId?[['baseline',request.baselineRunId]]:[])]){
  const evidence=a.evidence[name];if(!object(evidence)||evidence.runId!==id||!digest(evidence.snapshotHash)||!digest(evidence.resultHash)&&!(evidence.resultHash===null&&!result.deploymentAllowed))invalid();
 }
 if(!request.baselineRunId&&a.evidence.baseline!==undefined)invalid();
 const manual=result.manualApproval;
 if(manual!==undefined){
  if(!object(manual)||manual.required!==true||!['approved','rejected','missing','expired','invalid'].includes(manual.status)||result.deploymentAllowed&&manual.status!=='approved')invalid();
  if(manual.status==='missing'){if(manual.reviewId!==undefined||manual.reviewHash!==undefined)invalid();}
  else if(!uuid(manual.reviewId)||!digest(manual.reviewHash))invalid();
 }
 const compared=request.baselineRunId?comparison(result.comparison,request.candidateRunId,request.baselineRunId,manual!==undefined):{performed:false};
 if(!request.baselineRunId&&result.comparison!==undefined&&result.comparison!==null||result.deploymentAllowed&&compared.performed&&!compared.evaluationPassed)invalid();
 const completeHashes=digest(a.evidence.candidate.resultHash)&&(!request.baselineRunId||digest(a.evidence.baseline.resultHash));
 if(compared.performed&&compared.comparable&&!completeHashes||manual?.status==='approved'&&!digest(a.evidence.candidate.resultHash))invalid();
 const wrapper=Object.fromEntries(Object.entries(receipt).filter(([key])=>!['artifact','artifactHash','signature'].includes(key)));
 if(Object.keys(wrapper).length&&hash(wrapper)!==hash(result))invalid();
 if(expected){
  if(a.organizationId.toLowerCase()!==expected.organizationId||a.projectId.toLowerCase()!==expected.projectId||expected.candidateRunId!==undefined&&request.candidateRunId.toLowerCase()!==expected.candidateRunId||Object.hasOwn(expected,'baselineRunId')&&(request.baselineRunId?.toLowerCase()??null)!==expected.baselineRunId)invalid();
 }
 return {schemaVersion:1,purpose:'historical-receipt-inspection',receiptId:verified.receiptId,organizationId:verified.organizationId,projectId:verified.projectId,checkedAt:verified.checkedAt,keyId:verified.keyId,artifactHash:receipt.artifactHash,signatureVerified:true,structureVerified:true,historicalDecision:result.decision,reasonCount:result.reasons.length,manualApprovalStatus:manual?.status??'not_required',comparison:compared,evidenceReferenceHashesComplete:completeHashes,expectedScopeVerified:expected!==undefined,expectedCandidateVerified:expected?.candidateRunId!==undefined,expectedBaselineVerified:expected!==undefined&&Object.hasOwn(expected,'baselineRunId'),historicalEvidenceOnly:true,evidenceBodiesVerified:false,reviewBodyVerified:false,currentReleasePermissionVerified:false,deploymentAllowed:false};
}
