import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {Identity} from '../src/lib/contracts.ts';
import {campaignHistorySearchPage as parse,campaignHistorySearchPath as path,allCampaignHistorySearchFilters as all} from '../src/lib/campaign-history-search.ts';
import {proxyPath,oauthQuery} from '../src/lib/proxy-policy.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',dataset='33333333-3333-4333-8333-333333333333';
const user={organizationId:org,projectId:project} as Identity;
const row=(n:number)=>({id:'ffffffff-ffff-4fff-8fff-'+n.toString(16).padStart(12,'0'),agentVersionId:org,datasetVersionId:dataset,requiresApproval:true,createdAt:'2026-11-03T00:00:00.123456Z'});
function token(entry:ReturnType<typeof row>,filters=all,ds:string|null=null){const b=Buffer.alloc(113);b[0]=1;createHash('sha256').update('campaign-search-v1;approval='+filters.approval+';agent='+(filters.agentVersionId??'all')).digest().copy(b,1);b.write('CMP',33);Buffer.from(org.replaceAll('-',''),'hex').copy(b,36);Buffer.from(project.replaceAll('-',''),'hex').copy(b,52);b[68]=Number(ds!==null);if(ds)Buffer.from(ds.replaceAll('-',''),'hex').copy(b,69);b.writeBigInt64BE(BigInt(Date.parse('2026-11-03T00:00:00Z')/1000),85);b.writeInt32BE(123456000,93);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(b,97);return b.toString('base64url')}
const page=(entries:unknown[]=[row(3)],nextCursor:string|null=null,filters=all,ds:string|null=null)=>({organizationId:org,projectId:project,datasetVersionId:ds,entries,nextCursor,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false,filters});
test('search preserves exact last-row and requested boundary and all matching rows',async()=>{
 const rows=Array.from({length:25},(_,i)=>row(30-i)),next=token(rows.at(-1)!);
 assert.equal(next.length,151);assert.equal((await parse(page(rows,next),user,all,null)).nextCursor,next);
 assert.deepEqual((await parse(page([row(5)]),user,all,null,next)).entries,[row(5)]);
 await assert.rejects(parse(page([row(6)]),user,all,null,next));
 await assert.rejects(parse(page(rows,token(row(5))),user,all,null));
 const filters={approval:'required' as const,agentVersionId:org};
 assert.equal((await parse(page([row(3)],null,filters,dataset),user,filters,dataset)).entries.length,1);
});
test('changed approval agent dataset tenant or cursor domain cannot reuse results',async()=>{
 const next=token(row(6));
 for(const filters of [{approval:'required' as const,agentVersionId:null},{approval:'all' as const,agentVersionId:org}]){
  await assert.rejects(parse(page([],null,filters),user,filters,null,next));
  await assert.rejects(parse(page(),user,filters,null));
 }
 await assert.rejects(parse(page([],null,all,dataset),user,all,dataset,next));
 for(const foreign of [{...user,organizationId:dataset},{...user,projectId:dataset}])await assert.rejects(parse(page(),foreign,all,null,next));
 for(const invalid of [next+'=',next.slice(1),Buffer.from(next,'base64url').subarray(33).toString('base64url')])await assert.rejects(parse(page([]),user,all,null,invalid));
 const raw=Buffer.from(next,'base64url');raw[0]=2;await assert.rejects(parse(page([]),user,all,null,raw.toString('base64url')));
});
test('unexpected rows or authority are rejected rather than filtered or rendered',async()=>{
 for(const value of [{...page(),deploymentAuthority:true},{...page(),extra:'untrusted'},page([row(2),row(3)]),page([row(3),row(3)]),page([{...row(3),createdAt:'2026-02-30T00:00:00Z'}]),page([{...row(3),createdAt:'2026-11-03T00:00:00.123456001Z'}]),page([row(3)],token(row(3)))])await assert.rejects(parse(value,user,all,null));
 const filters={approval:'not-required' as const,agentVersionId:null};await assert.rejects(parse(page([row(3)],null,filters),user,filters,null));
 const agent={approval:'all' as const,agentVersionId:dataset};await assert.rejects(parse(page([row(3)],null,agent),user,agent,null));
});
test('GET-only routes reject writes unknown choices path injection and tenant queries',()=>{
 for(const route of [path(all,null),path(all,dataset,token(row(3),all,dataset)),path({approval:'required',agentVersionId:org},dataset)]){
  assert.equal(proxyPath(route.split('/'),'GET'),'/api/'+route);
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.throws(()=>proxyPath(route.split('/'),method));
  assert.throws(()=>oauthQuery('/api/'+route,new URLSearchParams('organizationId='+org)));
 }
 for(const route of ['campaign-history-search/all/approved/all','campaign-history-search/all/ALL/all','campaign-history-search/%61ll/all/all','campaign-history-search/all/all/../runs','campaign-history-search/all/all/all/'+token(row(3))+'='])assert.throws(()=>proxyPath(route.split('/'),'GET'));
 assert.throws(()=>path(all,'1-1-1-1-1'));assert.throws(()=>path({approval:'all',agentVersionId:'https://outside.invalid'},null));
});
