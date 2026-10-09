import assert from 'node:assert/strict';
import {fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {observationFailure,observationHttpFailure} from '../packages/operations/observation-failure.js';

export async function observationRequest(base,route,options={}, {fetchRequest=fetchLocalSmoke,readResponse=readReleaseResponse,onResponse=()=>{}}={}){
 assert.ok(['/v1/auth/login','/v1/me','/v1/operations-alerts','/v1/auth/logout'].includes(route));
 let response;
 try{response=await fetchRequest(base,route,options);}catch(error){
  if(options.signal?.aborted)throw observationFailure('interrupted');
  throw observationFailure(error?.name==='TimeoutError'?'request-timeout':'transport-failed');
 }
 try{onResponse(response);}catch{await response.body?.cancel().catch(()=>{});throw observationFailure('response-invalid');}
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw observationHttpFailure(response.status);}
 try{return {response,value:await readResponse(response)};}catch{
  if(options.signal?.aborted)throw observationFailure('interrupted');
  throw observationFailure('response-invalid');
 }
}
