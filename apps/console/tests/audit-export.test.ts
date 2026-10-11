import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditExport} from '../src/lib/audit.ts';
import {proxyPath,oauthQuery} from '../src/lib/proxy-policy.ts';
import type {Identity} from '../src/lib/contracts.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';
const user={organizationId:org,projectId:project,actorId:actor} as Identity;
const row=(n:number)=>({id:'ffffffff-ffff-4fff-8fff-'+n.toString(16).padStart(12,'0'),actorId:actor,resourceId:actor,action:'evaluation.completed',createdAt:'2026-10-12T00:00:00.123456Z'});
function cursor(entry:ReturnType<typeof row>){const b=Buffer.alloc(60);Buffer.from(org.replaceAll('-',''),'hex').copy(b);Buffer.from(project.replaceAll('-',''),'hex').copy(b,16);b.writeBigInt64BE(1791763200n,32);b.writeInt32BE(123456000,40);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(b,44);return b.toString('base64url')}
function document(entries:unknown[]=[row(2),row(1)],more=false){return {schemaVersion:1,kind:'project-audit-export',organizationId:org,projectId:project,ordering:'created-at-id-desc',limit:500,entries,recordCount:entries.length,hasOlderRecords:more,entireProjectHistory:!more,currentDeploymentAuthority:false,signed:false,newestCursor:entries.length?cursor(entries[0] as ReturnType<typeof row>):null,oldestCursor:entries.length?cursor(entries.at(-1) as ReturnType<typeof row>):null}}
function frame(doc:unknown=document()){const contentJson=JSON.stringify(doc);return {contentJson,contentSha256:createHash('sha256').update(contentJson).digest('hex'),contentBytes:Buffer.byteLength(contentJson),organizationId:org,projectId:project,signed:false,currentDeploymentAuthority:false}}
test('bounded export verifies exact bytes and distinguishes complete statement snapshot from latest 500',async()=>{
 assert.equal((await auditExport(frame(),user)).recordCount,2);assert.equal((await auditExport(frame(document([])),user)).recordCount,0);
 const entries=Array.from({length:500},(_,i)=>row(501-i));assert.equal((await auditExport(frame(document(entries,true)),user)).hasOlderRecords,true);assert.equal((await auditExport(frame(document(entries,false)),user)).entireProjectHistory,true);
});
test('corrupted bytes scope claimed signature and invented deployment permission are refused',async()=>{
 const valid=frame();for(const bad of [{...valid,contentJson:valid.contentJson+' '},{...valid,contentBytes:valid.contentBytes+1},{...valid,organizationId:actor},{...valid,projectId:actor},{...valid,signed:true},{...valid,currentDeploymentAuthority:true},{...valid,contentJson:'x'.repeat(262145)}])await assert.rejects(auditExport(bad,user));
});
test('recomputed unsigned hash does not bypass metadata boundaries order scope or completeness validation',async()=>{
 const doc=document();for(const bad of [{...doc,organizationId:actor},{...doc,projectId:actor},{...doc,signed:true},{...doc,currentDeploymentAuthority:true},{...doc,recordCount:3},{...doc,hasOlderRecords:true,entireProjectHistory:false},{...doc,newestCursor:cursor(row(9))},{...doc,oldestCursor:cursor(row(9))},document([row(1),row(2)]),document([row(2),row(2)]),document([{...row(2),action:'<script>'}]),document(Array.from({length:501},(_,i)=>row(502-i))),{...doc,secret:'unexpected'}])await assert.rejects(auditExport(frame(bad),user));
});
test('audit export proxy permits only fixed authenticated GET without query or writes',()=>{
 assert.equal(proxyPath(['audit-export'],'GET'),'/api/audit-export');for(const method of ['POST','DELETE','PATCH'])assert.throws(()=>proxyPath(['audit-export'],method));assert.throws(()=>proxyPath(['audit-export','foreign'],'GET'));assert.throws(()=>oauthQuery('/api/audit-export',new URLSearchParams('organizationId='+actor)));
});
