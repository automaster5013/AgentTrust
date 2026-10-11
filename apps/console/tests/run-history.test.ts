import test from 'node:test';
import assert from 'node:assert/strict';
import {runHistoryPage} from '../src/lib/run-history.ts';
import type {Identity} from '../src/lib/contracts.ts';
import {proxyPath,oauthQuery} from '../src/lib/proxy-policy.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';
const user={organizationId:org,projectId:project,actorId:actor} as Identity;
const row=(index:number,createdAt='2026-10-11T05:00:00.123456Z')=>({id:'ffffffff-ffff-4fff-8fff-'+index.toString(16).padStart(12,'0'),provider:'synthetic',scenario:'pass',requiresApproval:true,state:'succeeded',decision:'pass',createdAt});
function cursor(entry:ReturnType<typeof row>,scope=org){const b=Buffer.alloc(63);b.write('RUN');Buffer.from(scope.replaceAll('-',''),'hex').copy(b,3);Buffer.from(project.replaceAll('-',''),'hex').copy(b,19);b.writeBigInt64BE(BigInt(Date.parse(entry.createdAt.slice(0,19)+'Z')/1000),35);b.writeInt32BE(Number((entry.createdAt.split('.')[1]?.replace('Z','')??'').padEnd(9,'0')),43);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(b,47);return b.toString('base64url')}
const page=(entries:unknown[]=[row(3),row(2)],nextCursor:string|null=null)=>({organizationId:org,projectId:project,entries,nextCursor,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false});
test('run history navigation preserves PostgreSQL microsecond order and binds the next boundary to actual last row',()=>{
 const entries=Array.from({length:25},(_,i)=>row(30-i));assert.equal(runHistoryPage(page(entries,cursor(entries.at(-1)!)),user).entries.length,25);
 assert.equal(runHistoryPage(page([row(5)]),user,cursor(row(6))).entries[0].id,row(5).id);
 assert.equal(runHistoryPage(page([row(6,'2026-10-11T05:00:00.123455Z')]),user,cursor(row(6))).entries.length,1);
 assert.throws(()=>runHistoryPage(page([row(6)]),user,cursor(row(6))));
 assert.throws(()=>runHistoryPage(page(entries,cursor(row(5))),user));
 assert.throws(()=>runHistoryPage(page(entries,cursor(entries.at(-1)!,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),user));
});
test('run history rejects foreign scope duplicate rows wrong ordering invented permission and malformed timestamps',()=>{
 for(const invalid of [{...page(),organizationId:actor},{...page(),projectId:actor},{...page(),deploymentAuthority:true},{...page(),limit:250},page([row(3),row(3)]),page([row(2),row(3)]),page([row(3,'2026-02-30T05:00:00Z')]),page([row(3,'2026-10-11T05:00:00.123456001Z')]),page([row(3,'2026-10-11T05:00:00+00:00')]),page([row(3)],cursor(row(3))),page(Array.from({length:26},(_,i)=>row(30-i)))])assert.throws(()=>runHistoryPage(invalid,user));
 assert.throws(()=>runHistoryPage(page([{...row(3),provider:'<script>alert(1)</script>'}]),user));
 assert.throws(()=>runHistoryPage(page([{...row(3),secret:'hidden'}]),user));
 assert.throws(()=>runHistoryPage(page(),user,'short'));
});
test('run history proxy exposes bounded GET navigation without adding a writable route or arbitrary query',()=>{
 assert.equal(proxyPath(['run-history'],'GET'),'/api/run-history');assert.equal(proxyPath(['run-history',cursor(row(3))],'GET'),'/api/run-history/'+cursor(row(3)));
 for(const method of ['POST','DELETE','PUT'])assert.throws(()=>proxyPath(['run-history'],method));
 assert.throws(()=>proxyPath(['run-history','short'],'GET'));assert.throws(()=>proxyPath(['run-history',cursor(row(3))+'='],'GET'));assert.throws(()=>oauthQuery('/api/run-history',new URLSearchParams('organizationId='+actor)));
});

test('run cursor rejects audit domain and invalid engine-independent result states',()=>{const token=cursor(row(3)),bytes=Buffer.from(token,'base64url');bytes.write('BAD');assert.throws(()=>runHistoryPage(page(),user,bytes.toString('base64url')));assert.throws(()=>runHistoryPage(page([{...row(3),state:'failed',decision:'pass'}]),user));assert.throws(()=>runHistoryPage(page([{...row(3),requiresApproval:'true'}]),user));assert.throws(()=>runHistoryPage(page([{...row(3),provider:'unapproved-provider'}]),user));});
