import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {auditPeriod,auditPeriodSearchPage,auditPeriodSearchPath,type AuditPeriod} from '../src/lib/audit-period-search.ts';
import {auditFilters} from '../src/lib/audit-search.ts';import {proxyPath} from '../src/lib/proxy-policy.ts';import type {Identity} from '../src/lib/contracts.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';const user={organizationId:org,projectId:project,actorId:actor} as Identity;
const period=auditPeriod('2026-11-03','2026-11-03',actor,auditFilters('review.approved','all'));
const row=(n:number,createdAt='2026-11-03T23:59:59.999999Z')=>({id:'ffffffff-ffff-4fff-8fff-'+n.toString(16).padStart(12,'0'),actorId:actor,resourceId:actor,action:'review.approved',createdAt});
function token(entry:ReturnType<typeof row>,p:AuditPeriod=period,organization=org){const raw=Buffer.alloc(93);raw[0]=2;createHash('sha256').update('audit-period-start='+p.startDay+';end='+p.endDay+';actor='+(p.actorId??'all')+';action='+(p.filters.action??'all')+';resource='+(p.filters.resourceId??'all')).digest().copy(raw,1);Buffer.from(organization.replaceAll('-',''),'hex').copy(raw,33);Buffer.from(project.replaceAll('-',''),'hex').copy(raw,49);raw.writeBigInt64BE(BigInt(Date.parse(entry.createdAt.slice(0,19)+'Z')/1000),65);raw.writeInt32BE(Number(entry.createdAt.slice(20,26).padEnd(6,'0'))*1000,73);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(raw,77);return raw.toString('base64url');}
const frame=(entries:unknown[],nextCursor:string|null=null)=>({organizationId:org,projectId:project,entries,nextCursor,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false,filters:period.filters,actorId:period.actorId,startDay:period.startDay,endDay:period.endDay});
test('UTC period dates are real canonical days and include at most366 days',()=>{
 assert.equal(auditPeriod('2024-01-01','2024-12-31',null,auditFilters('all','all')).endDay,'2024-12-31');
 for(const [a,b] of [['2023-02-29','2023-03-01'],['2024-01-01','2025-01-01'],['2026-11-03','2026-11-02'],['1969-12-31','1970-01-01'],['2026-1-01','2026-01-01'],['','2026-11-03']])assert.throws(()=>auditPeriod(a,b,null,auditFilters('all','all')));
});
test('period pages retain microsecond order and exact final-row cursor across real date edges',async()=>{
 const entries=Array.from({length:25},(_,i)=>row(30-i));const next=token(entries.at(-1)!);assert.equal((await auditPeriodSearchPage(frame(entries,next),user,period)).nextCursor,next);
 assert.equal((await auditPeriodSearchPage(frame([row(5,'2026-11-03T00:00:00.000000Z')]),user,period,next)).entries.length,1);
 for(const createdAt of ['2026-11-02T23:59:59.999999Z','2026-11-04T00:00:00.000000Z'])await assert.rejects(()=>auditPeriodSearchPage(frame([row(1,createdAt)]),user,period));
});
test('changed date actor filters tenant schema and invented permission are refused',async()=>{
 const next=token(row(6));const changes=[auditPeriod('2026-11-02','2026-11-03',actor,period.filters),auditPeriod('2026-11-03','2026-11-04',actor,period.filters),auditPeriod('2026-11-03','2026-11-03',null,period.filters),auditPeriod('2026-11-03','2026-11-03',actor,auditFilters('all','all'))];
 for(const changed of changes)await assert.rejects(()=>auditPeriodSearchPage(frame([]),user,period,token(row(6),changed)));
 await assert.rejects(()=>auditPeriodSearchPage(frame([]),user,period,token(row(6),period,actor)));
 const legacy=Buffer.from(next,'base64url');legacy[0]=1;await assert.rejects(()=>auditPeriodSearchPage(frame([]),user,period,legacy.toString('base64url')));
 for(const value of [{...frame([]),actorId:org},{...frame([]),endDay:'2026-11-04'},{...frame([]),deploymentAuthority:true},frame([{...row(2),actorId:org}]),frame([{...row(2),action:'review.rejected'}])])await assert.rejects(()=>auditPeriodSearchPage(value,user,period));
});
test('period routes are bounded GETs and cannot carry alternate scope or writes',()=>{
 const path=auditPeriodSearchPath(period,token(row(6)));assert.equal(proxyPath(path.slice(9).split('/'),'GET'),path.replace('/backend/','/api/'));
 for(const method of ['POST','PUT','DELETE'])assert.throws(()=>proxyPath(path.slice(9).split('/'),method));
 assert.throws(()=>auditPeriodSearchPath(period,'A'.repeat(168)));assert.throws(()=>proxyPath([...path.slice(9).split('/'),'organization',org],'GET'));
});
