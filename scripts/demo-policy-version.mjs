import assert from 'node:assert/strict';
import {hash} from '../packages/contracts/hash.js';

// Reuse only the exact immutable synthetic policy, never a same-name policy.
export async function ensureDemoReviewPolicy({call,policies,name}){
 assert.ok(typeof call==='function'&&Array.isArray(policies)&&policies.length<=1000);
 assert.ok(typeof name==='string'&&name.length>0&&name.length<=100);
 const data={name,minimumPassRate:1,requiresManualApproval:true,manualApprovalTtlSeconds:3600},expectedHash=hash(data);
 const inspect=async id=>{
  assert.match(id||'',/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  const version=await call('/v1/versions/'+id);
  assert.equal(version.id,id);assert.equal(version.kind,'policy');assert.equal(version.contentHash,expectedHash);assert.equal(hash(version.data),expectedHash);
 };
 const existing=policies.find(p=>p?.name===name&&p.contentHash===expectedHash);
 if(existing){
  assert.match(existing.id||'',/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(existing.minimumPassRate,1);assert.equal(existing.requiresManualApproval,true);assert.equal(existing.manualApprovalTtlSeconds,3600);
  await inspect(existing.id);
  return {id:existing.id,contentHash:expectedHash,reused:true};
 }
 const created=await call('/v1/policy-versions',data);
 assert.equal(created?.contentHash,expectedHash);for(const key of Object.keys(data))assert.equal(created[key],data[key]);
 await inspect(created.id);
 return {id:created.id,contentHash:expectedHash,reused:false};
}
