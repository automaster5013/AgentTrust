import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runHistorySearchPage,runHistorySearchPath,runHistorySearchFilters,allRunHistorySearchFilters,type RunHistorySearchFilters} from '../src/lib/run-history-search.ts';
import {proxyPath,oauthQuery} from '../src/lib/proxy-policy.ts';
import type {Identity} from '../src/lib/contracts.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
const user={organizationId:org,projectId:project,actorId:'33333333-3333-4333-8333-333333333333'} as Identity;
const all={...allRunHistorySearchFilters};
const row=(index:number)=>({id:'ffffffff-ffff-4fff-8fff-'+index.toString(16).padStart(12,'0'),provider:'synthetic',scenario:'pass',requiresApproval:true,state:'succeeded',decision:'pass',createdAt:'2026-11-01T08:00:00.123456Z'});
function token(entry:ReturnType<typeof row>,filters=all,organization=org){
 const old=Buffer.alloc(63);old.write('RUN');Buffer.from(organization.replaceAll('-',''),'hex').copy(old,3);Buffer.from(project.replaceAll('-',''),'hex').copy(old,19);old.writeBigInt64BE(BigInt(Date.parse('2026-11-01T08:00:00Z')/1000),35);old.writeInt32BE(123456000,43);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(old,47);
 const canonical='scenario='+filters.scenario+';approval='+filters.approval+';state='+filters.state+';decision='+filters.decision+';provider='+filters.provider;
 return Buffer.concat([Buffer.from([1]),createHash('sha256').update(canonical).digest(),old]).toString('base64url');
}
const page=(entries:unknown[]=[row(3)],nextCursor:string|null=null,filters=all)=>({organizationId:org,projectId:project,entries,nextCursor,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false,filters});

test('search binds the exact five filters and existing microsecond/tenant/last-row navigation',async()=>{
 const entries=Array.from({length:25},(_,i)=>row(30-i)),next=token(entries.at(-1)!);
 const parsed=await runHistorySearchPage(page(entries,next),user,all);assert.equal(parsed.nextCursor,next);assert.equal(parsed.entries.length,25);
 assert.equal((await runHistorySearchPage(page([row(5)]),user,all,token(row(6)))).entries[0].id,row(5).id);
 await assert.rejects(runHistorySearchPage(page(entries,token(row(4))),user,all));
 await assert.rejects(runHistorySearchPage(page([row(6)]),user,all,token(row(6))));
 await assert.rejects(runHistorySearchPage(page([],null),user,all,token(row(6),all,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')));
});

test('search never accepts a cursor or response from another condition',async()=>{
 for(const filters of [{...all,scenario:'block'},{...all,approval:'not-required'},{...all,state:'failed'},{...all,decision:'block'},{...all,provider:'ollama'}] as RunHistorySearchFilters[]){
  await assert.rejects(runHistorySearchPage(page([],null,filters),user,filters,token(row(6))));
  await assert.rejects(runHistorySearchPage(page([row(3)],null,filters),user,filters));
  await assert.rejects(runHistorySearchPage(page([],null),user,filters));
 }
});

test('search rejects malformed envelopes, extra data, invented authority and unrelated boundaries',async()=>{
 for(const invalid of [{...page(),organizationId:project},{...page(),deploymentAuthority:true},{...page(),secret:'must-not-render'},page([row(3),row(3)]),page([row(3)],token(row(3))),{...page(),filters:{...all,unknown:'value'}}])await assert.rejects(runHistorySearchPage(invalid,user,all));
 const valid=token(row(6));
 for(const invalid of [valid+'=',valid.slice(1),Buffer.from(valid,'base64url').subarray(33).toString('base64url')])await assert.rejects(runHistorySearchPage(page([]),user,all,invalid));
 const bytes=Buffer.from(valid,'base64url');bytes[0]=2;await assert.rejects(runHistorySearchPage(page([]),user,all,bytes.toString('base64url')));
});

test('only fixed choices and GET routes reach authenticated search; no tenant override query exists',()=>{
 const path=runHistorySearchPath(all);assert.equal(path,'run-history-search/all/all/all/all/all');assert.equal(proxyPath(path.split('/'),'GET'),'/api/'+path);
 const next=runHistorySearchPath(all,token(row(3)));assert.equal(proxyPath(next.split('/'),'GET'),'/api/'+next);
 for(const method of ['POST','PUT','DELETE','PATCH'])assert.throws(()=>proxyPath(path.split('/'),method));
 for(const invalid of ['run-history-search/ALL/all/all/all/all','run-history-search/%61ll/all/all/all/all','run-history-search/all/all/all/all/unknown',next+'='])assert.throws(()=>proxyPath(invalid.split('/'),'GET'));
 assert.throws(()=>proxyPath(['run-history-search','all/all/all/all/all'],'GET'));
 assert.throws(()=>oauthQuery('/api/'+path,new URLSearchParams('organizationId='+org)));
 for(const invalid of [{...all,state:'cancelled'},{...all,approval:'approved'},{...all,provider:'https://outside.invalid'}, {...all,scenario:undefined}])assert.throws(()=>runHistorySearchFilters(invalid));
});
