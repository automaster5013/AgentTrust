import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hash} from '../packages/contracts/hash.js';
import {ensureDemoReviewPolicy} from '../scripts/demo-policy-version.mjs';
const name='Portfolio synthetic administrator review',data={name,minimumPassRate:1,requiresManualApproval:true,manualApprovalTtlSeconds:3600};
function fixture(){const id=randomUUID(),contentHash=hash(data),calls=[];return {entry:{...data,id,contentHash},version:{id,kind:'policy',contentHash,data:structuredClone(data)},calls};}
test('repeated demonstration reuses a verified exact policy without another creation',async()=>{
 const f=fixture();let policies=[];const call=async(path,body)=>{f.calls.push({path,body});if(body){policies=[f.entry];return f.entry;}return f.version;};
 const first=await ensureDemoReviewPolicy({call,policies,name}),second=await ensureDemoReviewPolicy({call,policies,name});assert.equal(first.reused,false);assert.equal(second.reused,true);assert.equal(second.id,first.id);assert.equal(f.calls.filter(c=>c.body).length,1);assert.deepEqual(f.calls[0].body,data);assert.equal(f.calls[1].path,'/v1/versions/'+f.entry.id);
});
test('a same-name weaker or differently expiring policy cannot replace the synthetic approval policy',async()=>{
 for(const weaker of [{minimumPassRate:0.5},{requiresManualApproval:false},{manualApprovalTtlSeconds:86400}]){const f=fixture(),other={...data,...weaker};const chosen=await ensureDemoReviewPolicy({name,policies:[{...other,id:randomUUID(),contentHash:hash(other)}],call:async(path,body)=>{if(body){assert.equal(path,'/v1/policy-versions');assert.deepEqual(body,data);return f.entry;}assert.equal(path,'/v1/versions/'+f.entry.id);return f.version;}});assert.equal(chosen.reused,false);assert.equal(chosen.id,f.entry.id);}
});
test('a claimed matching catalog hash cannot hide an altered policy body or version identity',async()=>{
 for(const mutate of [v=>v.data.minimumPassRate=0.5,v=>v.id=randomUUID(),v=>v.kind='dataset',v=>v.contentHash='0'.repeat(64)]){const f=fixture();mutate(f.version);await assert.rejects(ensureDemoReviewPolicy({name,policies:[f.entry],call:async(path,body)=>{assert.equal(body,undefined);return f.version;}}));}
});
test('invalid matching IDs and inconsistent approval metadata do not trigger reads or creation',async()=>{
 for(const change of [{id:'../private'},{requiresManualApproval:false},{minimumPassRate:0.1},{manualApprovalTtlSeconds:60}]){const f=fixture();await assert.rejects(ensureDemoReviewPolicy({name,policies:[{...f.entry,...change}],call:async()=>{assert.fail('No request may be made');}}));}
});
test('a failed immutable policy read never falls back to silently creating another version',async()=>{
 const f=fixture();let reads=0;await assert.rejects(ensureDemoReviewPolicy({name,policies:[f.entry],call:async(path,body)=>{assert.equal(body,undefined);reads++;throw Error('Synthetic unavailable version');}}));assert.equal(reads,1);
});
test('first creation also verifies the returned declaration and stored immutable body before use',async()=>{
 for(const field of ['id','contentHash','minimumPassRate','storedBody']){const f=fixture();let reads=0;const call=async(path,body)=>{if(body){const created={...f.entry};if(field==='id')created.id='../private';if(field==='contentHash')created.contentHash='0'.repeat(64);if(field==='minimumPassRate')created.minimumPassRate=0.5;return created;}reads++;assert.equal(path,'/v1/versions/'+f.entry.id);return {...f.version,data:{...data,manualApprovalTtlSeconds:86400}};};await assert.rejects(ensureDemoReviewPolicy({name,policies:[],call}));assert.equal(reads,field==='storedBody'?1:0);}
});
