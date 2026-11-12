import type {Detail} from './contracts.ts';
import {recordedCanonical} from './recorded-text-contracts.ts';
export type FlatSchema={type:'object';properties:Record<string,{type:'string';enum?:string[];minLength?:number;maxLength?:number}>;required:string[];additionalProperties:false};
export type ConnectorRule={id:string;required:boolean}&({type:'contains'|'not_contains';value:string}|{type:'allowed_tools';allowed:string[];argumentSchemas?:Record<string,FlatSchema>}|{type:'json_schema';schema:FlatSchema});
export type ConnectorEvidence={output:string|null;toolEvents:{name:string|null;args:Record<string,string>|null}[]|null};
export type ConnectorCase={id:string;scenario:'quality';required:boolean;input:string;evidence:ConnectorEvidence;rules:ConnectorRule[]};
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('INVALID_CONNECTOR');return v as Record<string,unknown>}
function fields(v:Record<string,unknown>,names:string[],optional:string[]=[]){if(names.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!names.includes(k)&&!optional.includes(k)))throw Error('INVALID_CONNECTOR')}
function text(v:unknown,max:number,nonempty=false):string{if(typeof v!=='string'||!v.isWellFormed()||v.includes('\0')||nonempty&&!v.length||new TextEncoder().encode(v).length>max)throw Error('INVALID_CONNECTOR');return v}
function id(v:unknown):string{const s=text(v,64,true);if(!/^[a-z][a-z0-9-]{0,63}$/.test(s))throw Error('INVALID_CONNECTOR');return s}
function key(v:string):string{if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v)||['constructor','prototype','__proto__'].includes(v))throw Error('INVALID_CONNECTOR');return v}
function hash(v:unknown):string{const s=text(v,64,true);if(!/^[a-f0-9]{64}$/.test(s))throw Error('INVALID_CONNECTOR');return s}
function bool(v:unknown):boolean{if(typeof v!=='boolean')throw Error('INVALID_CONNECTOR');return v}
function bytes(v:unknown,max:number){if(new TextEncoder().encode(JSON.stringify(recordedCanonical(v))).length>max)throw Error('CONNECTOR_LIMIT')}
export function flatSchema(value:unknown):FlatSchema{
 const v=object(value);fields(v,['type','properties','required','additionalProperties']);if(v.type!=='object'||v.additionalProperties!==false)throw Error('UNSUPPORTED_SCHEMA');const props=object(v.properties);
 if(Object.keys(props).length>8||!Array.isArray(v.required)||v.required.length>8||new Set(v.required).size!==v.required.length||v.required.some(k=>typeof k!=='string'||!Object.hasOwn(props,k)))throw Error('INVALID_SCHEMA');
 const properties:FlatSchema['properties']={};for(const [name,value] of Object.entries(props)){key(name);const s=object(value);fields(s,['type'],['enum','minLength','maxLength']);if(s.type!=='string')throw Error('UNSUPPORTED_SCHEMA');
  for(const name of ['minLength','maxLength'])if(Object.hasOwn(s,name)&&(!Number.isInteger(s[name])||(s[name] as number)<0||(s[name] as number)>512))throw Error('INVALID_SCHEMA');if((s.minLength as number??0)>(s.maxLength as number??512))throw Error('INVALID_SCHEMA');
  const result:FlatSchema['properties'][string]={type:'string'};if(Object.hasOwn(s,'enum')){if(!Array.isArray(s.enum)||!s.enum.length||s.enum.length>8)throw Error('INVALID_SCHEMA');const options=s.enum.map(x=>text(x,128));if(new Set(options).size!==options.length)throw Error('INVALID_SCHEMA');result.enum=options}if(Object.hasOwn(s,'minLength'))result.minLength=s.minLength as number;if(Object.hasOwn(s,'maxLength'))result.maxLength=s.maxLength as number;properties[name]=result;
 }
 return {type:'object',properties,required:v.required as string[],additionalProperties:false};
}
function schemaMatches(schema:FlatSchema,value:unknown):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const data=value as Record<string,unknown>;if(Object.keys(data).length>8||schema.required.some(k=>!Object.hasOwn(data,k)))return false;
 for(const [name,item] of Object.entries(data)){if(!Object.hasOwn(schema.properties,name))return false;let value;try{value=text(item,512)}catch{return false}const s=schema.properties[name],length=Array.from(value).length;if(length<(s.minLength??0)||length>(s.maxLength??512)||s.enum&&!s.enum.includes(value))return false}return true;
}
function observation(value:unknown):ConnectorEvidence{
 const v=object(value);fields(v,['output','toolEvents']);const output=v.output===null?null:text(v.output,512);let toolEvents:ConnectorEvidence['toolEvents']=null;
 if(v.toolEvents!==null){if(!Array.isArray(v.toolEvents)||v.toolEvents.length>4)throw Error('INVALID_CONNECTOR');toolEvents=v.toolEvents.map(value=>{const e=object(value);fields(e,['name','args']);let args:Record<string,string>|null=null;if(e.args!==null){const raw=object(e.args);if(Object.keys(raw).length>8)throw Error('INVALID_CONNECTOR');args=Object.fromEntries(Object.entries(raw).map(([k,v])=>[key(k),text(v,128)]))}return {name:e.name===null?null:text(e.name,64),args}})}return {output,toolEvents};
}
export function connectorCase(value:unknown):ConnectorCase{
 const c=object(value);fields(c,['id','scenario','required','input','evidence','rules']);if(c.scenario!=='quality'||!Array.isArray(c.rules)||!c.rules.length||c.rules.length>4)throw Error('INVALID_CONNECTOR');
 const rules=c.rules.map((value):ConnectorRule=>{const r=object(value),base={id:id(r.id),required:bool(r.required)};
  if(r.type==='contains'||r.type==='not_contains'){fields(r,['id','type','required','value']);return {...base,type:r.type,value:text(r.value,64,true)}}
  if(r.type==='json_schema'){fields(r,['id','type','required','schema']);return {...base,type:r.type,schema:flatSchema(r.schema)}}
  if(r.type==='allowed_tools'){fields(r,['id','type','required','allowed'],['argumentSchemas']);if(!Array.isArray(r.allowed)||r.allowed.length>4)throw Error('INVALID_CONNECTOR');const allowed=r.allowed.map(v=>key(text(v,64,true)));if(new Set(allowed).size!==allowed.length)throw Error('INVALID_CONNECTOR');const result:ConnectorRule={...base,type:'allowed_tools',allowed};if(Object.hasOwn(r,'argumentSchemas'))result.argumentSchemas=Object.fromEntries(Object.entries(object(r.argumentSchemas)).map(([k,v])=>{if(!allowed.includes(k))throw Error('INVALID_CONNECTOR');return [k,flatSchema(v)]}));return result}
  throw Error('UNSUPPORTED_RULE');
 });if(!rules.some(r=>r.required)||new Set(rules.map(r=>r.id)).size!==rules.length)throw Error('INVALID_CONNECTOR');
 const result:ConnectorCase={id:id(c.id),scenario:'quality',required:bool(c.required),input:text(c.input,512),evidence:observation(c.evidence),rules};bytes(result,3072);return result;
}
export function connectorCases(value:unknown):ConnectorCase[]{if(!Array.isArray(value)||!value.length||value.length>2)throw Error('INVALID_CONNECTOR');const result=value.map(connectorCase);if(new Set(result.map(c=>c.id)).size!==result.length||!result.some(c=>c.required))throw Error('INVALID_CONNECTOR');bytes({contract:'recorded-connector-rules-v1',cases:result},6144);return result}
export function connectorProfile(value:unknown,provider:string):Record<string,unknown>{
 const p=object(value),expected={schemaVersion:1,contract:'recorded-connector-execution-profile-v1',provider:'synthetic',ajvVersion:'8.20.0',schemaSubset:'flat-string-object-v1',maxCases:2,maxRulesPerCase:4,inputUtf8Bytes:512,outputUtf8Bytes:512,ruleValueUtf8Bytes:64,maxToolEvents:4,maxAllowedTools:4,maxArgumentProperties:8,caseJsonBytes:3072,datasetJsonBytes:6144,jobJsonBytes:4096,executionDeadlineSeconds:120,evaluationTimeoutSeconds:1,verifierTimeoutSeconds:4,maxAttempts:1,arbitraryCodeAllowed:false,callerSelectedUrlAllowed:false,providerCallsAllowed:false,toolExecutionAllowed:false};
 fields(p,[...Object.keys(expected),'sourceSha256','validatorProfileSha256']);if(provider!=='synthetic'||Object.entries(expected).some(([k,v])=>p[k]!==v))throw Error('INVALID_CONNECTOR_PROFILE');hash(p.validatorProfileSha256);const source=object(p.sourceSha256);fields(source,['connector_evaluator.py','connector_worker.py','connector_application.py','connector_profiles.py','recorded_evaluator.py']);Object.values(source).forEach(hash);return {...p,sourceSha256:{...source}};
}
function status(rule:ConnectorRule,e:ConnectorEvidence):'pass'|'fail'|'inconclusive'{
 if(rule.type==='allowed_tools'){if(e.toolEvents===null)return 'inconclusive';for(const event of e.toolEvents){if(event.name===null||event.args===null)return 'inconclusive';if(!rule.allowed.includes(event.name))return 'fail';const schema=rule.argumentSchemas?.[event.name];if(schema&&!schemaMatches(schema,event.args))return 'fail'}return 'pass'}
 if(e.output===null)return 'inconclusive';if(rule.type==='contains'||rule.type==='not_contains')return e.output.includes(rule.value)===(rule.type==='contains')?'pass':'fail';
 if(rule.type!=='json_schema')throw Error('UNSUPPORTED_RULE');try{return schemaMatches(rule.schema,strictConnectorJson(e.output,512))?'pass':'fail'}catch{return 'fail'}
}
export function verifyConnectorRules(value:unknown,result:Detail['result']):void{
 const c=connectorCase(value);if(result.executionEngine==='java-cancelled'&&result.state==='failed'&&result.decision==='inconclusive'&&result.rules.length===1&&result.rules[0].id==='evaluation-cancelled'&&result.rules[0].required&&result.rules[0].status==='inconclusive')return;
 const unavailable=result.executionEngine==='python-unavailable'?'worker-availability':result.executionEngine==='python-synthetic'?'recorded-connector-execution':null;
 if(result.state==='failed'){if(!unavailable||result.decision!=='inconclusive'||result.rules.length!==1||result.rules[0].id!==unavailable||!result.rules[0].required||result.rules[0].status!=='inconclusive'||result.rules[0].reason!==(unavailable==='worker-availability'?'Python worker response or scoped evidence was unavailable.':'Recorded connector evaluation was unavailable.'))throw Error('INVALID_CONNECTOR_RESULT');return}
 if(result.executionEngine!=='python-synthetic'||result.state!=='succeeded'||result.rules.length!==c.rules.length)throw Error('INVALID_CONNECTOR_RESULT');let fail=false,missing=false;
 c.rules.forEach((declared,index)=>{const expected=status(declared,c.evidence),rule=result.rules[index];if(rule.id!==declared.id||rule.required!==declared.required||rule.status!==expected||rule.reason!==`Recorded connector ${declared.type} rule evaluated.`)throw Error('INVALID_CONNECTOR_RESULT');fail ||=declared.required&&expected==='fail';missing ||=declared.required&&expected==='inconclusive'});if(result.decision!==(fail?'block':missing?'inconclusive':'pass'))throw Error('INVALID_CONNECTOR_RESULT');
}
export function strictConnectorJson(source:string,maxBytes=8192){
 if(typeof source!=='string'||!source.isWellFormed()||new TextEncoder().encode(source).length>maxBytes)throw Error('INVALID_JSON');
 let p=0,nodes=0;const ws=()=>{while(/[\x20\t\r\n]/.test(source[p]??'')&&p<source.length)p++};
 function string(){const start=p;if(source[p++]!=='"')throw Error('INVALID_JSON');let escaped=false;for(;p<source.length;p++){const c=source[p];if(!escaped&&c==='"'){p++;const value=JSON.parse(source.slice(start,p));if(!value.isWellFormed())throw Error('INVALID_JSON');return value}if(!escaped&&c==='\\')escaped=true;else escaped=false}throw Error('INVALID_JSON')}
 function value(depth:number):unknown{ws();if(depth>12||++nodes>512)throw Error('INVALID_JSON');const c=source[p];if(c==='"')return string();
  if(c==='{'){p++;ws();const result:Record<string,unknown>={};const seen=new Set<string>();if(source[p]==='}'){p++;return result}for(;;){ws();const k=string();if(seen.has(k))throw Error('DUPLICATE_JSON_KEY');seen.add(k);ws();if(source[p++]!==':')throw Error('INVALID_JSON');const item=value(depth+1);Object.defineProperty(result,k,{value:item,enumerable:true,writable:true,configurable:true});ws();const end=source[p++];if(end==='}')return result;if(end!==',')throw Error('INVALID_JSON')}}
  if(c==='['){p++;ws();const result:unknown[]=[];if(source[p]===']'){p++;return result}for(;;){result.push(value(depth+1));ws();const end=source[p++];if(end===']')return result;if(end!==',')throw Error('INVALID_JSON')}}
  for(const [literal,item] of ([['true',true],['false',false],['null',null]] as const))if(source.startsWith(literal,p)){p+=literal.length;return item}
  const match=source.slice(p).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);if(!match)throw Error('INVALID_JSON');p+=match[0].length;const number=Number(match[0]);if(!Number.isFinite(number))throw Error('INVALID_JSON');return number;
 }
 const result=value(0);ws();if(p!==source.length)throw Error('INVALID_JSON');return result;
}

