import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const CONTRACT='recorded-connector-case-v1';
export const AJV_VERSION='8.20.0';
export function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)])):v}
export function digest(v){return createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')}
export function profileHash(){
 const files=['connector-policy.mjs','connector-server.mjs','connector-application.mjs','package-lock.json'];
 return createHash('sha256').update('recorded-connector-verifier-v1\n'+files.map(name=>readFileSync(new URL('./'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex');
}
function obj(v){if(!v||typeof v!=='object'||Array.isArray(v))throw Error('INVALID_CONNECTOR');return v}
function fields(v,names,optional=[]){obj(v);if(names.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!names.includes(k)&&!optional.includes(k)))throw Error('INVALID_CONNECTOR')}
function text(v,max,nonempty=false){if(typeof v!=='string'||!v.isWellFormed()||v.includes('\0')||nonempty&&!v.length||Buffer.byteLength(v)>max)throw Error('INVALID_CONNECTOR');return v}
function id(v){if(!/^[a-z][a-z0-9-]{0,63}$/.test(text(v,64,true)))throw Error('INVALID_CONNECTOR');return v}
function key(v){if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(text(v,64,true))||['constructor','prototype','__proto__'].includes(v))throw Error('INVALID_CONNECTOR');return v}

// Bounded parsing preserves duplicate-key rejection, including escaped equal keys.
export function strictJson(source,maxBytes=8192){
 if(typeof source!=='string'||!source.isWellFormed()||Buffer.byteLength(source)>maxBytes)throw Error('INVALID_JSON');
 let p=0,nodes=0;const ws=()=>{while(/[\x20\t\r\n]/.test(source[p]??'')&&p<source.length)p++};
 function string(){const start=p;if(source[p++]!=='"')throw Error('INVALID_JSON');let escaped=false;for(;p<source.length;p++){const c=source[p];if(!escaped&&c==='"'){p++;const value=JSON.parse(source.slice(start,p));if(!value.isWellFormed())throw Error('INVALID_JSON');return value}if(!escaped&&c==='\\')escaped=true;else escaped=false}throw Error('INVALID_JSON')}
 function value(depth){ws();if(depth>12||++nodes>512)throw Error('INVALID_JSON');const c=source[p];if(c==='"')return string();
  if(c==='{'){p++;ws();const result={};const seen=new Set();if(source[p]==='}'){p++;return result}for(;;){ws();const k=string();if(seen.has(k))throw Error('DUPLICATE_JSON_KEY');seen.add(k);ws();if(source[p++]!==':')throw Error('INVALID_JSON');const item=value(depth+1);Object.defineProperty(result,k,{value:item,enumerable:true,writable:true,configurable:true});ws();const end=source[p++];if(end==='}')return result;if(end!==',')throw Error('INVALID_JSON')}}
  if(c==='['){p++;ws();const result=[];if(source[p]===']'){p++;return result}for(;;){result.push(value(depth+1));ws();const end=source[p++];if(end===']')return result;if(end!==',')throw Error('INVALID_JSON')}}
  for(const [literal,item] of [['true',true],['false',false],['null',null]])if(source.startsWith(literal,p)){p+=literal.length;return item}
  const match=source.slice(p).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);if(!match)throw Error('INVALID_JSON');p+=match[0].length;const number=Number(match[0]);if(!Number.isFinite(number))throw Error('INVALID_JSON');return number;
 }
 const result=value(0);ws();if(p!==source.length)throw Error('INVALID_JSON');return result;
}

export function flatSchema(v){
 fields(v,['type','properties','required','additionalProperties']);if(v.type!=='object'||v.additionalProperties!==false)throw Error('UNSUPPORTED_SCHEMA');obj(v.properties);
 if(Object.keys(v.properties).length>8||!Array.isArray(v.required)||v.required.length>8||new Set(v.required).size!==v.required.length||v.required.some(k=>typeof k!=='string'||!Object.hasOwn(v.properties,k)))throw Error('INVALID_SCHEMA');
 for(const [name,s] of Object.entries(v.properties)){key(name);fields(s,['type'],['enum','minLength','maxLength']);if(s.type!=='string')throw Error('UNSUPPORTED_SCHEMA');for(const name of ['minLength','maxLength'])if(Object.hasOwn(s,name)&&(!Number.isInteger(s[name])||s[name]<0||s[name]>512))throw Error('INVALID_SCHEMA');if((s.minLength??0)>(s.maxLength??512))throw Error('INVALID_SCHEMA');if(Object.hasOwn(s,'enum')){if(!Array.isArray(s.enum)||!s.enum.length||s.enum.length>8)throw Error('INVALID_SCHEMA');s.enum.forEach(x=>text(x,128));if(new Set(s.enum).size!==s.enum.length)throw Error('INVALID_SCHEMA')}}
 return v;
}
export function definitionCase(c){
 fields(c,['id','scenario','required','input','evidence','rules']);id(c.id);if(c.scenario!=='quality'||typeof c.required!=='boolean')throw Error('INVALID_CONNECTOR');text(c.input,512);
 fields(c.evidence,['output','toolEvents']);if(c.evidence.output!==null)text(c.evidence.output,512);const events=c.evidence.toolEvents;
 if(events!==null){if(!Array.isArray(events)||events.length>4)throw Error('INVALID_CONNECTOR');for(const e of events){fields(e,['name','args']);if(e.name!==null)text(e.name,64);if(e.args!==null){obj(e.args);if(Object.keys(e.args).length>8)throw Error('INVALID_CONNECTOR');for(const [k,v] of Object.entries(e.args)){key(k);text(v,128)}}}}
 if(!Array.isArray(c.rules)||!c.rules.length||c.rules.length>4||!c.rules.some(r=>r?.required===true))throw Error('INVALID_CONNECTOR');const seen=new Set();
 for(const r of c.rules){obj(r);id(r.id);if(seen.has(r.id)||typeof r.required!=='boolean')throw Error('INVALID_CONNECTOR');seen.add(r.id);
  if(['contains','not_contains'].includes(r.type)){fields(r,['id','type','required','value']);text(r.value,64,true)}
  else if(r.type==='json_schema'){fields(r,['id','type','required','schema']);flatSchema(r.schema)}
  else if(r.type==='allowed_tools'){fields(r,['id','type','required','allowed'],['argumentSchemas']);if(!Array.isArray(r.allowed)||r.allowed.length>4)throw Error('INVALID_CONNECTOR');r.allowed.forEach(key);if(new Set(r.allowed).size!==r.allowed.length)throw Error('INVALID_CONNECTOR');if(Object.hasOwn(r,'argumentSchemas')){obj(r.argumentSchemas);for(const [name,schema] of Object.entries(r.argumentSchemas)){if(!r.allowed.includes(name))throw Error('INVALID_CONNECTOR');flatSchema(schema)}}}
  else throw Error('UNSUPPORTED_RULE');
 }
 if(Buffer.byteLength(JSON.stringify(canonical(c)))>3072)throw Error('CASE_LIMIT');return c;
}
export function validateSample(s){fields(s,['contract','case','contentSha256']);if(s.contract!==CONTRACT||s.contentSha256!==digest({contract:CONTRACT,case:definitionCase(s.case)}))throw Error('INVALID_SAMPLE');return s.case}

export function connectorGrader(Ajv){
 return sample=>{const c=validateSample(sample);const ajv=new Ajv({strict:true,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false,ownProperties:true});
  function status(r){const e=c.evidence;
   if(r.type==='allowed_tools'){if(e.toolEvents===null)return 'inconclusive';for(const event of e.toolEvents){if(event.name===null||event.args===null)return 'inconclusive';if(!r.allowed.includes(event.name))return 'fail';const schema=r.argumentSchemas?.[event.name];if(schema&&!ajv.compile(schema)(event.args))return 'fail'}return 'pass'}
   if(e.output===null)return 'inconclusive';if(r.type==='contains'||r.type==='not_contains')return e.output.includes(r.value)===(r.type==='contains')?'pass':'fail';
   try{const data=strictJson(e.output,512);obj(data);for(const value of Object.values(data))text(value,512);return ajv.compile(r.schema)(data)?'pass':'fail'}catch{return 'fail'}
  }
  return {caseSha256:sample.contentSha256,statuses:c.rules.map(status),engine:'ajv-flat-object-v1',ajvVersion:AJV_VERSION,validatorProfileSha256:profileHash()};
 };
}
