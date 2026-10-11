import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPage} from '../src/lib/audit.ts';
import type {Identity} from '../src/lib/contracts.ts';
import {proxyPath,oauthQuery} from '../src/lib/proxy-policy.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';
const user={organizationId:org,projectId:project,actorId:actor} as Identity;
const row=(index:number,createdAt='2026-10-11T05:00:00.123456Z')=>({id:'ffffffff-ffff-4fff-8fff-'+index.toString(16).padStart(12,'0'),actorId:actor,resourceId:actor,action:'evaluation.completed',createdAt});
function cursor(entry:ReturnType<typeof row>,scope=org){const b=Buffer.alloc(60);Buffer.from(scope.replaceAll('-',''),'hex').copy(b);Buffer.from(project.replaceAll('-',''),'hex').copy(b,16);b.writeBigInt64BE(BigInt(Date.parse(entry.createdAt.slice(0,19)+'Z')/1000),32);b.writeInt32BE(Number((entry.createdAt.split('.')[1]?.replace('Z','')??'').padEnd(9,'0')),40);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(b,44);return b.toString('base64url')}
const page=(entries:unknown[]=[row(3),row(2)],nextCursor:string|null=null)=>({organizationId:org,projectId:project,entries,nextCursor,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false});
test('audit navigation preserves PostgreSQL microsecond order and binds the next boundary to actual last row',()=>{
 const entries=Array.from({length:25},(_,i)=>row(30-i));assert.equal(auditPage(page(entries,cursor(entries.at(-1)!)),user).entries.length,25);
 assert.equal(auditPage(page([row(5)]),user,cursor(row(6))).entries[0].id,row(5).id);
 assert.equal(auditPage(page([row(6,'2026-10-11T05:00:00.123455Z')]),user,cursor(row(6))).entries.length,1);
 assert.throws(()=>auditPage(page([row(6)]),user,cursor(row(6))));
 assert.throws(()=>auditPage(page(entries,cursor(row(5))),user));
 assert.throws(()=>auditPage(page(entries,cursor(entries.at(-1)!,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),user));
});
test('audit rejects foreign scope duplicate rows wrong ordering invented permission and malformed timestamps',()=>{
 for(const invalid of [{...page(),organizationId:actor},{...page(),projectId:actor},{...page(),deploymentAuthority:true},{...page(),limit:250},page([row(3),row(3)]),page([row(2),row(3)]),page([row(3,'2026-02-30T05:00:00Z')]),page([row(3,'2026-10-11T05:00:00.123456001Z')]),page([row(3,'2026-10-11T05:00:00+00:00')]),page([row(3)],cursor(row(3))),page(Array.from({length:26},(_,i)=>row(30-i)))])assert.throws(()=>auditPage(invalid,user));
 assert.throws(()=>auditPage(page([{...row(3),action:'<script>alert(1)</script>'}]),user));
 assert.throws(()=>auditPage(page([{...row(3),secret:'hidden'}]),user));
 assert.throws(()=>auditPage(page(),user,'short'));
});
test('audit proxy exposes bounded GET navigation without adding a writable route or arbitrary query',()=>{
 assert.equal(proxyPath(['audit'],'GET'),'/api/audit');assert.equal(proxyPath(['audit',cursor(row(3))],'GET'),'/api/audit/'+cursor(row(3)));
 for(const method of ['POST','DELETE','PUT'])assert.throws(()=>proxyPath(['audit'],method));
 assert.throws(()=>proxyPath(['audit','short'],'GET'));assert.throws(()=>proxyPath(['audit',cursor(row(3))+'='],'GET'));assert.throws(()=>oauthQuery('/api/audit',new URLSearchParams('organizationId='+actor)));
});
