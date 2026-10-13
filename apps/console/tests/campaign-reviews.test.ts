import test from 'node:test';import assert from 'node:assert/strict';
import {campaignReviews} from '../src/lib/campaign-reviews.ts';import {proxyPath} from '../src/lib/proxy-policy.ts';import type {Identity} from '../src/lib/contracts.ts';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';const user={organizationId:id,projectId:id} as Identity;
const entry={id,actor_id:id,decision:'approved',reason:'fixture',review_sequence:2,policy_version:'1.0.0',policy_digest:'sha256:'+'a'.repeat(64),created_at:'2026-10-13T12:00:00Z'};
const frame=()=>({campaignId:id,organizationId:id,projectId:id,limit:50,deploymentAuthority:false,entries:[{...entry}]});
test('review history binds scope, order and metadata without current deployment authority',()=>{assert.equal(campaignReviews(frame(),user,id)[0].sequence,2);assert.deepEqual(campaignReviews({...frame(),entries:[]},user,id),[]);assert.equal(proxyPath(['campaigns',id,'reviews'],'GET'),'/api/campaigns/'+id+'/reviews');assert.throws(()=>proxyPath(['campaigns',id,'reviews'],'DELETE'))});
test('cross-scope, duplicated, reversed, excessive and malformed review frames fail closed',()=>{
 for(const v of [{...frame(),organizationId:other},{...frame(),deploymentAuthority:true},{...frame(),entries:[entry,entry]},{...frame(),entries:[entry,{...entry,id:other,review_sequence:3}]},{...frame(),entries:Array(51).fill(entry)},{...frame(),entries:[{...entry,policy_digest:'bad'}]},{...frame(),entries:[{...entry,created_at:'invalid'}]}])assert.throws(()=>campaignReviews(v,user,id));
});

test('review timestamps preserve UTC precision and reject normalized or ambiguous dates',()=>{
 for(const created_at of ['2026-10-13T12:00:00Z','2026-10-13T12:00:00.644+00:00','2026-10-13T12:00:00.123456Z','2024-02-29T23:59:59.123456789Z'])assert.equal(campaignReviews({...frame(),entries:[{...entry,created_at}]},user,id)[0].createdAt,created_at);
 for(const created_at of ['2026-02-30T12:00:00Z','2025-02-29T12:00:00Z','2026-10-13T24:00:00Z','2026-10-13','2026-10-13T12:00:00','2026-10-13T12:00:00+09:00'])assert.throws(()=>campaignReviews({...frame(),entries:[{...entry,created_at}]},user,id));
});
