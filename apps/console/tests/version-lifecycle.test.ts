import test from 'node:test';import assert from 'node:assert/strict';
import {versionLifecycle,campaignLifecycle,verifyLifecyclePermission} from '../src/lib/version-lifecycle.ts';
import {proxyPath} from '../src/lib/proxy-policy.ts';
import {requireActiveVersion} from '../src/lib/active-version.ts';
import type {Version} from '../src/lib/campaign-contracts.ts';
import type {Identity,Gate} from '../src/lib/contracts.ts';import type {Campaign} from '../src/lib/campaign-contracts.ts';
const id=(n:number)=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12);
const user={organizationId:id(1),projectId:id(2)} as Identity;
const record={id:id(3),agent_version_id:id(4),dataset_version_id:id(5),agent_content_sha256:'a'.repeat(64),dataset_content_sha256:'b'.repeat(64)} as Campaign;
const entry=(kind:'agents'|'datasets',versionId:string,contentSha256:string)=>({contract:'version-lifecycle-v1',kind,versionId,contentSha256,organizationId:user.organizationId,projectId:user.projectId,state:'active',deploymentAuthority:false});
const agent=entry('agents',record.agent_version_id,record.agent_content_sha256),dataset=entry('datasets',record.dataset_version_id,record.dataset_content_sha256);
const retired={...agent,state:'retired',reason:'Known invalid profile',retiredBy:id(6),retiredAt:'2026-10-12T02:00:00Z'};
const scope={contract:'campaign-version-lifecycle-v1',campaignId:record.id,organizationId:user.organizationId,projectId:user.projectId,versions:[agent,dataset],deploymentAuthority:false};
test('new evaluation admission refuses a verified retired version',()=>{
 const version={id:record.agent_version_id,content_sha256:record.agent_content_sha256} as Version;
 assert.equal(requireActiveVersion(agent,user,'agents',version).state,'active');
 assert.throws(()=>requireActiveVersion(retired,user,'agents',version),/폐기된 버전/);
 assert.throws(()=>requireActiveVersion({...agent,contentSha256:'c'.repeat(64)},user,'agents',version));
});
test('active and retired states bind the exact tenant version and original hash',()=>{
 assert.equal(versionLifecycle(agent,user,'agents',record.agent_version_id,record.agent_content_sha256).state,'active');
 assert.equal(versionLifecycle(retired,user,'agents',record.agent_version_id,record.agent_content_sha256).state,'retired');
 for(const altered of [{...agent,projectId:id(7)},{...agent,versionId:id(7)},{...agent,contentSha256:'c'.repeat(64)},{...agent,state:'restored'},{...agent,retiredAt:retired.retiredAt},{...retired,retiredBy:'invalid'},{...retired,reason:''}])assert.throws(()=>versionLifecycle(altered,user,'agents',record.agent_version_id,record.agent_content_sha256));
});
test('retired signed observations cannot claim permission or future retirement time',()=>{
 const value=campaignLifecycle({...scope,versions:[retired,dataset]},user,record);
 const now=Date.parse(retired.retiredAt);
 assert.throws(()=>verifyLifecyclePermission(value,{deploymentAllowed:true} as Gate,now));
 assert.throws(()=>verifyLifecyclePermission(value,{deploymentAllowed:false} as Gate,now-1));
 assert.doesNotThrow(()=>verifyLifecyclePermission(value,{deploymentAllowed:false} as Gate,now));
 assert.throws(()=>campaignLifecycle({...scope,versions:[dataset,agent]},user,record));
 assert.throws(()=>campaignLifecycle({...scope,versions:[agent]},user,record));
});
test('lifecycle read and retirement mutation use distinct exact proxy methods',()=>{
 const path=['versions','agents',record.agent_version_id,'lifecycle'];
 assert.equal(proxyPath(path,'GET'),'/api/'+path.join('/'));assert.throws(()=>proxyPath(path,'POST'));
 assert.equal(proxyPath([...path,'retirement'],'POST'),'/api/'+[...path,'retirement'].join('/'));
 assert.throws(()=>proxyPath([...path,'retirement'],'GET'));assert.throws(()=>proxyPath([...path,'retirement','extra'],'POST'));
});

test('retirement timestamps reject calendar normalization while preserving exact UTC fractions',()=>{
 for(const retiredAt of ['2026-02-30T02:00:00Z','2026-10-12T24:00:00Z','2026-10-12T02:00Z','2026-10-12T02:00:00.1234567890Z'])assert.throws(()=>versionLifecycle({...retired,retiredAt},user,'agents',record.agent_version_id,record.agent_content_sha256));
 for(const retiredAt of ['2024-02-29T02:00:00Z','2026-10-12T02:00:00.123456789Z'])assert.equal(versionLifecycle({...retired,retiredAt},user,'agents',record.agent_version_id,record.agent_content_sha256).retiredAt,retiredAt);
});