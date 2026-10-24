import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignHistoryPage,filterCampaignHistoryPage} from '../src/lib/campaign-history.ts';
import type {Identity} from '../src/lib/contracts.ts';
import {proxyPath,oauthQuery} from '../src/lib/proxy-policy.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',dataset='33333333-3333-4333-8333-333333333333';
const user={organizationId:org,projectId:project} as Identity;
const row=(index:number,createdAt='2026-10-11T05:00:00.123456Z')=>({id:'ffffffff-ffff-4fff-8fff-'+index.toString(16).padStart(12,'0'),agentVersionId:org,datasetVersionId:dataset,requiresApproval:true,createdAt});
function cursor(entry:ReturnType<typeof row>,filter:string|null=null,organization=org){const b=Buffer.alloc(80);b.write('CMP');Buffer.from(organization.replaceAll('-',''),'hex').copy(b,3);Buffer.from(project.replaceAll('-',''),'hex').copy(b,19);b[35]=Number(filter!==null);if(filter)Buffer.from(filter.replaceAll('-',''),'hex').copy(b,36);b.writeBigInt64BE(BigInt(Date.parse(entry.createdAt.slice(0,19)+'Z')/1000),52);b.writeInt32BE(Number((entry.createdAt.split('.')[1]?.replace('Z','')??'').padEnd(9,'0')),60);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(b,64);return b.toString('base64url')}
const page=(entries:unknown[]=[row(3),row(2)],nextCursor:string|null=null,filter:string|null=null)=>({organizationId:org,projectId:project,datasetVersionId:filter,entries,nextCursor,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false});
test('campaign history verifies exact microseconds and the actual last-row boundary',()=>{
 const entries=Array.from({length:25},(_,i)=>row(30-i));assert.equal(campaignHistoryPage(page(entries,cursor(entries.at(-1)!)),user).entries.length,25);
 assert.equal(campaignHistoryPage(page([row(5)]),user,null,cursor(row(6))).entries[0].id,row(5).id);
 assert.equal(campaignHistoryPage(page([row(6,'2026-10-11T05:00:00.123455Z')]),user,null,cursor(row(6))).entries.length,1);
 assert.throws(()=>campaignHistoryPage(page([row(6)]),user,null,cursor(row(6))));assert.throws(()=>campaignHistoryPage(page(entries,cursor(row(5))),user));
});
test('campaign dataset filter is bound to rows page and requested navigation',()=>{
 const entries=Array.from({length:25},(_,i)=>row(30-i));assert.equal(campaignHistoryPage(page(entries,cursor(entries.at(-1)!,dataset),dataset),user,dataset).entries.length,25);
 assert.throws(()=>campaignHistoryPage(page(entries,cursor(entries.at(-1)!),dataset),user,dataset));
 assert.throws(()=>campaignHistoryPage(page(entries,cursor(entries.at(-1)!,dataset)),user));
 assert.throws(()=>campaignHistoryPage(page([{...row(3),datasetVersionId:org}],null,dataset),user,dataset));
 assert.throws(()=>campaignHistoryPage(page([],null,dataset),user,dataset,cursor(row(3))));
 assert.throws(()=>campaignHistoryPage(page([],null,dataset),user,dataset,cursor(row(3),dataset,project)));
});
test('campaign history refuses duplicate order malformed time forged authority and noncanonical cursors',()=>{
 for(const invalid of [{...page(),organizationId:dataset},{...page(),projectId:dataset},{...page(),deploymentAuthority:true},{...page(),limit:250},page([row(3),row(3)]),page([row(2),row(3)]),page([row(3,'2026-02-30T05:00:00Z')]),page([row(3,'2026-10-11T05:00:00.123456001Z')]),page([{...row(3),requiresApproval:'true'}]),page([{...row(3),secret:'hidden'}]),page(Array.from({length:26},(_,i)=>row(30-i)))])assert.throws(()=>campaignHistoryPage(invalid,user));
 const token=cursor(row(3)),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',noncanonical=token.slice(0,-1)+alphabet[alphabet.indexOf(token.at(-1)!)+1];
 assert.throws(()=>campaignHistoryPage(page(),user,null,noncanonical));const bytes=Buffer.from(token,'base64url');bytes.write('RUN');assert.throws(()=>campaignHistoryPage(page(),user,null,bytes.toString('base64url')));
 assert.throws(()=>campaignHistoryPage(page(),user,null,token+'='));
});
test('campaign history proxy admits only bounded authenticated read navigation',()=>{
 for(const segments of [['campaign-history'],['campaign-history','page',cursor(row(3))],['campaign-history','dataset',dataset],['campaign-history','dataset',dataset,'page',cursor(row(3),dataset)]]){
  assert.equal(proxyPath(segments,'GET'),'/api/'+segments.join('/'));for(const method of ['POST','PUT','DELETE'])assert.throws(()=>proxyPath(segments,method));
 }
 for(const segments of [['campaign-history','page','short'],['campaign-history','organization',org],['campaign-history','dataset',dataset,'page',cursor(row(3))+'=']])assert.throws(()=>proxyPath(segments,'GET'));
 assert.throws(()=>oauthQuery('/api/campaign-history',new URLSearchParams('organizationId='+org)));
});

test('campaign filters intersect version and request approval without altering scoped cursor',()=>{
 const entries=Array.from({length:25},(_,i)=>({...row(30-i),requiresApproval:i%2===0,agentVersionId:i%3===0?project:org}));
 const verified=campaignHistoryPage(page(entries,cursor(entries.at(-1)!)),user),before=JSON.stringify(verified);
 assert.deepEqual(filterCampaignHistoryPage(verified,{approval:'required',agentVersionId:project}),entries.filter((_,i)=>i%2===0&&i%3===0));
 assert.deepEqual(filterCampaignHistoryPage(verified,{approval:'not-required',agentVersionId:null}),entries.filter((_,i)=>i%2!==0));
 assert.deepEqual(filterCampaignHistoryPage(verified,{approval:'all',agentVersionId:dataset}),[]);
 assert.equal(verified.nextCursor,cursor(entries.at(-1)!));assert.equal(JSON.stringify(verified),before);
 assert.deepEqual(filterCampaignHistoryPage(verified,{approval:'all',agentVersionId:null}),entries);
 assert.deepEqual(filterCampaignHistoryPage({entries:[],nextCursor:null},{approval:'required',agentVersionId:project}),[]);
});
test('campaign filters reject unknown approval states and noncanonical version identifiers',()=>{
 const verified=campaignHistoryPage(page(),user);
 for(const filter of [{approval:'approved',agentVersionId:null},{approval:'all',agentVersionId:'partial'},{approval:'all',agentVersionId:'FFFFFFFF-FFFF-4FFF-8FFF-FFFFFFFFFFFF'}])assert.throws(()=>filterCampaignHistoryPage(verified,filter as Parameters<typeof filterCampaignHistoryPage>[1]));
});
