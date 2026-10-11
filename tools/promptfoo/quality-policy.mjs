import {evaluate} from 'promptfoo';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const VERSION='reference-answer-verifier-v1';
const sdkVersion=JSON.parse(readFileSync(new URL('./node_modules/promptfoo/package.json',import.meta.url),'utf8')).version;
if(sdkVersion!=='0.124.1')throw Error('Verifier SDK version differs');
export function profileHash(){
 const source=readFileSync(new URL('./quality-policy.mjs',import.meta.url)).toString('utf8').replace(/\r\n/g,'\n');
 const transport=readFileSync(new URL('./quality-server.mjs',import.meta.url)).toString('utf8').replace(/\r\n/g,'\n');
 const lock=readFileSync(new URL('./package-lock.json',import.meta.url)).toString('utf8').replace(/\r\n/g,'\n');
 return createHash('sha256').update(VERSION+'\n'+source+'\n'+transport+'\n'+lock).digest('hex');
}
export async function gradeRaw(actual,expected){
 if(typeof actual!=='string'||Buffer.byteLength(actual)>2048||typeof expected!=='string'||!expected.trim()||Buffer.byteLength(expected)>128)throw Error('Invalid bounded reference sample');
 const reference=expected.normalize('NFC').trim();
 // Neither caller string becomes a prompt template, a variable, code, file or URL.
 const check=output=>{
  try{
   const value=JSON.parse(output);
   const canonicalKey=/^\s*\{\s*"answer"\s*:\s*"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"\s*\}\s*$/u.test(output);
   return canonicalKey&&value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&typeof value.answer==='string'&&value.answer.normalize('NFC').trim()===reference;
  }catch{return false}
 };
 const result=await evaluate({description:'Bounded ephemeral reference answer verification',writeLatestResults:false,
  prompts:['reference-answer'],providers:[async()=>({output:actual})],
  tests:[{assert:[{type:'is-json'},{type:'javascript',value:check}]}]},
  {cache:false,sharing:false,writeLatestResults:false,maxConcurrency:1});
 const summary=await result.toEvaluateSummary();
 if(summary.results.length!==1||summary.stats.successes+summary.stats.failures!==1)throw Error('Verifier unavailable');
 const row=summary.results[0];
 const components=row.gradingResult?.componentResults;
 if(!Array.isArray(components)||components.length!==2||components[0].assertion?.type!=='is-json'||components[1].assertion?.type!=='javascript'||components.some(c=>typeof c.pass!=='boolean')||typeof row.success!=='boolean'||row.success!==components.every(c=>c.pass))throw Error('Verifier unavailable');
 return {graded:true,pass:row.success,assertions:components.length,engine:'promptfoo',version:sdkVersion,validatorProfileSha256:profileHash()};
}
