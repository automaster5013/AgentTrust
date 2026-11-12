import type {Detail} from './contracts.ts';
export type RecordedRule={id:string;type:'contains'|'not_contains';required:boolean;value:string};
export type RecordedCase={id:string;scenario:'quality';required:boolean;input:string;output:string;rules:RecordedRule[]};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_RECORDED_TEXT');return value as Record<string,unknown>}
function fields(value:Record<string,unknown>,names:string[]){if(Object.keys(value).sort().join(',')!==names.sort().join(','))throw Error('INVALID_RECORDED_TEXT')}
function text(value:unknown,max:number,nonempty=false):string{if(typeof value!=='string'||nonempty&&!value.length||!value.isWellFormed()||value.includes('\0')||new TextEncoder().encode(value).length>max)throw Error('INVALID_RECORDED_TEXT');return value}
function id(value:unknown):string{const result=text(value,64,true);if(!/^[a-z][a-z0-9-]{0,63}$/.test(result))throw Error('INVALID_RECORDED_TEXT');return result}
function bool(value:unknown):boolean{if(typeof value!=='boolean')throw Error('INVALID_RECORDED_TEXT');return value}
function hash(value:unknown):string{const result=text(value,64);if(!/^[a-f0-9]{64}$/.test(result))throw Error('INVALID_RECORDED_TEXT');return result}
export function recordedCanonical(value:unknown):unknown{if(Array.isArray(value))return value.map(recordedCanonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,recordedCanonical(item)]));return value}
function bytes(value:unknown,max:number){if(new TextEncoder().encode(JSON.stringify(recordedCanonical(value))).length>max)throw Error('INVALID_RECORDED_TEXT')}
export function recordedCase(value:unknown):RecordedCase{
 const c=object(value);fields(c,['id','scenario','required','input','output','rules']);if(c.scenario!=='quality'||!Array.isArray(c.rules)||!c.rules.length||c.rules.length>4)throw Error('INVALID_RECORDED_TEXT');
 const rules=c.rules.map(value=>{const r=object(value);fields(r,['id','type','required','value']);if(r.type!=='contains'&&r.type!=='not_contains')throw Error('INVALID_RECORDED_TEXT');return {id:id(r.id),type:r.type,required:bool(r.required),value:text(r.value,64,true)} as RecordedRule});
 if(new Set(rules.map(r=>r.id)).size!==rules.length||!rules.some(r=>r.required))throw Error('INVALID_RECORDED_TEXT');
 const result:RecordedCase={id:id(c.id),scenario:'quality',required:bool(c.required),input:text(c.input,512),output:text(c.output,512),rules};bytes(result,2048);return result;
}
export function recordedCases(value:unknown):RecordedCase[]{
 if(!Array.isArray(value)||!value.length||value.length>2)throw Error('INVALID_RECORDED_TEXT');const result=value.map(recordedCase);
 if(new Set(result.map(c=>c.id)).size!==result.length||!result.some(c=>c.required))throw Error('INVALID_RECORDED_TEXT');bytes({contract:'recorded-text-rules-v1',cases:result},4096);return result;
}
export function recordedProfile(value:unknown,provider:string):Record<string,unknown>{
 const p=object(value),expected={schemaVersion:1,contract:'recorded-text-execution-profile-v1',provider:'synthetic',maxCases:2,maxRulesPerCase:4,inputUtf8Bytes:512,outputUtf8Bytes:512,ruleValueUtf8Bytes:64,caseJsonBytes:2048,datasetJsonBytes:4096,jobJsonBytes:4096,executionDeadlineSeconds:120,evaluationTimeoutSeconds:1,maxAttempts:1,comparison:'case-sensitive-literal-unmodified-Unicode',arbitraryCodeAllowed:false,callerSelectedUrlAllowed:false,providerCallsAllowed:false};
 fields(p,[...Object.keys(expected),'sourceSha256']);if(provider!=='synthetic'||Object.entries(expected).some(([key,value])=>p[key]!==value))throw Error('INVALID_RECORDED_PROFILE');
 const sources=object(p.sourceSha256);fields(sources,['recorded_evaluator.py','recorded_worker.py','recorded_application.py','recorded_profiles.py']);Object.values(sources).forEach(hash);return {...p,sourceSha256:{...sources}};
}
export function verifyRecordedRules(value:unknown,result:Detail['result']):void{
 const c=recordedCase(value);
 if(result.executionEngine==='java-cancelled'&&result.state==='failed'&&result.decision==='inconclusive'&&result.rules.length===1&&result.rules[0].id==='evaluation-cancelled'&&result.rules[0].required&&result.rules[0].status==='inconclusive')return;
 if(result.executionEngine==='python-unavailable'&&result.state==='failed'&&result.decision==='inconclusive'&&JSON.stringify(result.rules)===JSON.stringify([{id:'worker-availability',required:true,status:'inconclusive',reason:'Python worker response or scoped evidence was unavailable.'}]))return;
 if(result.executionEngine!=='python-synthetic')throw Error('INVALID_RECORDED_RESULT');
 if(result.state==='failed'){if(result.decision!=='inconclusive'||JSON.stringify(result.rules)!==JSON.stringify([{id:'recorded-text-execution',required:true,status:'inconclusive',reason:'Recorded text evaluation was unavailable.'}])&&JSON.stringify(result.rules)!==JSON.stringify([{id:'worker-availability',required:true,status:'inconclusive',reason:'Python worker response or scoped evidence was unavailable.'}]))throw Error('INVALID_RECORDED_RESULT');return}
 if(result.rules.length!==c.rules.length)throw Error('INVALID_RECORDED_RESULT');let failed=false;
 c.rules.forEach((declared,index)=>{const present=c.output.includes(declared.value),passed=declared.type==='contains'?present:!present,rule=result.rules[index];failed ||= declared.required&&!passed;if(rule.id!==declared.id||rule.required!==declared.required||rule.status!==(passed?'pass':'fail')||rule.reason!==`Recorded text ${declared.type} rule ${passed?'passed':'failed'}.`)throw Error('INVALID_RECORDED_RESULT')});
 if(result.state!=='succeeded'||result.decision!==(failed?'block':'pass'))throw Error('INVALID_RECORDED_RESULT');
}
