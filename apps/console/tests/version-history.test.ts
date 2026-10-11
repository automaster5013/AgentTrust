import test from 'node:test';import assert from 'node:assert/strict';
import {versionHistoryPage,verifyVersionHistoryBinding,type VersionKind} from '../src/lib/version-history.ts';
import type {Identity} from '../src/lib/contracts.ts';import {proxyPath} from '../src/lib/proxy-policy.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';const user={organizationId:org,projectId:project} as Identity;
const row=(n:number)=>({id:'ffffffff-ffff-4fff-8fff-'+n.toString(16).padStart(12,'0'),resourceKey:'agent-test',version:n,contentSha256:'a'.repeat(64),createdAt:'2026-10-11T05:00:00.123456Z'});
function cursor(entry:ReturnType<typeof row>,kind:VersionKind='agents',scope=org){const b=Buffer.alloc(63);b.write(kind==='agents'?'AGS':'DTS');Buffer.from(scope.replaceAll('-',''),'hex').copy(b,3);Buffer.from(project.replaceAll('-',''),'hex').copy(b,19);b.writeBigInt64BE(1791694800n,35);b.writeInt32BE(123456000,43);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(b,47);return b.toString('base64url')}
const page=(entries:unknown[]=[row(3),row(2)],nextCursor:string|null=null,kind:VersionKind='agents')=>({organizationId:org,projectId:project,kind,entries,nextCursor,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false});
test('version history binds exact microseconds last-row boundaries and registry kinds',()=>{for(const kind of ['agents','datasets'] as const){const rows=Array.from({length:25},(_,i)=>row(30-i));assert.equal(versionHistoryPage(page(rows,cursor(rows.at(-1)!,kind),kind),user,kind).entries.length,25);assert.equal(versionHistoryPage(page([row(5)],null,kind),user,kind,cursor(row(6),kind)).entries[0].id,row(5).id);assert.throws(()=>versionHistoryPage(page([row(6)],null,kind),user,kind,cursor(row(6),kind)));}assert.throws(()=>versionHistoryPage(page([],null,'datasets'),user,'datasets',cursor(row(6))));});
test('version history refuses foreign scope ordering duplicates malformed coordinates or hashes',()=>{for(const v of [{...page(),organizationId:project},{...page(),projectId:org},{...page(),kind:'datasets'},{...page(),deploymentAuthority:true},page([row(2),row(3)]),page([row(3),row(3)]),page([{...row(3),contentSha256:'b'}]),page([{...row(3),resourceKey:'../escape'}]),page([{...row(3),version:0}]),page([{...row(3),createdAt:'2026-02-30T05:00:00Z'}]),page([{...row(3),private:'hidden'}]),page([row(3)],cursor(row(3))),page(Array.from({length:26},(_,i)=>row(30-i)))])assert.throws(()=>versionHistoryPage(v,user,'agents'));assert.throws(()=>versionHistoryPage(page(),user,'agents',cursor(row(6),'agents',project)));});
test('registry navigation never proxies writes or other kinds',()=>{for(const kind of ['agents','datasets']){assert.equal(proxyPath(['version-history',kind],'GET'),'/api/version-history/'+kind);assert.equal(proxyPath(['version-history',kind,cursor(row(3))],'GET'),'/api/version-history/'+kind+'/'+cursor(row(3)));for(const method of ['POST','PUT','DELETE'])assert.throws(()=>proxyPath(['version-history',kind],method));}assert.throws(()=>proxyPath(['version-history','other'],'GET'));});

test('immutable detail selection binds microseconds even when JavaScript milliseconds match',()=>{
 const registered=versionHistoryPage(page([row(3)]),user,'agents').entries[0];
 assert.equal(Date.parse(registered.created_at),Date.parse('2026-10-11T05:00:00.123457Z'));
 assert.throws(()=>verifyVersionHistoryBinding(registered,{...registered,created_at:'2026-10-11T05:00:00.123457Z'}));
 verifyVersionHistoryBinding(registered,{...registered,created_at:'2026-10-11T05:00:00.123456000Z'});
 for(const created_at of ['2026-10-11T05:00:00.123456001Z','2026-02-30T05:00:00.123456Z','2026-10-11T05:00:00.123456+00:00'])assert.throws(()=>verifyVersionHistoryBinding(registered,{...registered,created_at}));
});
test('detail selection refuses substituted identity key version and immutable hash',()=>{
 const registered=versionHistoryPage(page([row(3)]),user,'agents').entries[0];
 for(const changed of [{id:row(2).id},{resource_key:'another-agent'},{version:2},{content_sha256:'b'.repeat(64)}])assert.throws(()=>verifyVersionHistoryBinding(registered,{...registered,...changed}));
});
