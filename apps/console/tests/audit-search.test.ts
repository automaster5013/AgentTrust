import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {auditFilters,auditSearchPage,auditSearchPath,type AuditFilters} from '../src/lib/audit-search.ts';
import {proxyPath,oauthQuery} from '../src/lib/proxy-policy.ts';import type {Identity} from '../src/lib/contracts.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';const user={organizationId:org,projectId:project,actorId:actor} as Identity;
const filters=auditFilters('version.agents.retired',actor);
const row=(number:number,nanos=123456000)=>({id:'ffffffff-ffff-4fff-8fff-'+number.toString(16).padStart(12,'0'),actorId:actor,resourceId:actor,action:'version.agents.retired',createdAt:'2026-10-12T09:00:00.'+String(nanos).padStart(9,'0')+'Z'});
function token(entry:ReturnType<typeof row>,requested:AuditFilters=filters,organization=org){const raw=Buffer.alloc(93);raw[0]=1;createHash('sha256').update('action='+(requested.action??'all')+';resource='+(requested.resourceId??'all')).digest().copy(raw,1);Buffer.from(organization.replaceAll('-',''),'hex').copy(raw,33);Buffer.from(project.replaceAll('-',''),'hex').copy(raw,49);raw.writeBigInt64BE(BigInt(Date.parse(entry.createdAt.slice(0,19)+'Z')/1000),65);raw.writeInt32BE(Number(entry.createdAt.slice(20,29)),73);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(raw,77);return raw.toString('base64url');}
const page=(entries:unknown[],nextCursor:string|null=null)=>({organizationId:org,projectId:project,entries,nextCursor,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false,filters});
test('audit search binds matching rows and exact microsecond navigation to its filter and tenant',async()=>{
 const rows=Array.from({length:25},(_,i)=>row(30-i));assert.equal((await auditSearchPage(page(rows,token(rows.at(-1)!)),user,filters)).nextCursor,token(rows.at(-1)!));
 assert.equal((await auditSearchPage(page([row(6,123455000)]),user,filters,token(row(6)))).entries.length,1);
 await assert.rejects(()=>auditSearchPage(page([row(6)]),user,filters,token(row(6))));
 for(const changed of [auditFilters('all',actor),auditFilters('version.datasets.retired',actor),auditFilters('version.agents.retired','all')])await assert.rejects(()=>auditSearchPage(page([]),user,filters,token(row(6),changed)));
 await assert.rejects(()=>auditSearchPage(page([]),user,filters,token(row(6),filters,actor)));
 await assert.rejects(()=>auditSearchPage(page(rows,token(row(4))),user,filters));
});
test('audit search refuses substituted filters rows scope authority and malformed cursors',async()=>{
 for(const value of [{...page([]),filters:{...filters,resourceId:null}},{...page([]),projectId:actor},{...page([]),deploymentAuthority:true},page([{...row(2),action:'review.approved'}]),page([{...row(2),resourceId:org}]),page([row(2),row(2)]),page([row(1),row(2)])])await assert.rejects(()=>auditSearchPage(value,user,filters));
 for(const invalid of [token(row(2))+'=',token(row(2)).slice(1),'!'+token(row(2)).slice(1)])await assert.rejects(()=>auditSearchPage(page([]),user,filters,invalid));
 const raw=Buffer.from(token(row(2)),'base64url');raw[0]=2;await assert.rejects(()=>auditSearchPage(page([]),user,filters,raw.toString('base64url')));
});
test('audit search routes permit only bounded reads without query or alternate scope',()=>{
 const path=auditSearchPath(filters,token(row(2)));assert.equal(proxyPath(path.slice('/backend/'.length).split('/'),'GET'),path.replace('/backend/','/api/'));
 for(const method of ['POST','PUT','DELETE'])assert.throws(()=>proxyPath(['audit-search','all','all'],method));
 assert.throws(()=>proxyPath(['audit-search','all','all',token(row(2))+'='],'GET'));assert.throws(()=>oauthQuery('/api/audit-search/all/all',new URLSearchParams('organization='+org)));
 for(const invalid of ['ALL','review.deleted','version.agents.retired/../../runs'])assert.throws(()=>auditFilters(invalid,'all'));
 for(const invalid of ['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA','1-1-1-1-1',actor+'?actor=other'])assert.throws(()=>auditFilters('all',invalid));
});
