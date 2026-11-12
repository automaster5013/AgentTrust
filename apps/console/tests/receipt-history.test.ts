import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptHistoryPage} from '../src/lib/receipt-history.ts';
import type {Identity} from '../src/lib/contracts.ts';
import {proxyPath,oauthQuery} from '../src/lib/proxy-policy.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',campaign='33333333-3333-4333-8333-333333333333';
const user={organizationId:org,projectId:project} as Identity;
const row=(index:number,createdAt='2026-10-11T05:00:00.123456Z')=>({id:'ffffffff-ffff-4fff-8fff-'+index.toString(16).padStart(12,'0'),campaignId:campaign,keyId:'a'.repeat(64),createdAt});
function cursor(entry:ReturnType<typeof row>,filter:string|null=null,organization=org){const b=Buffer.alloc(80);b.write('RCP');Buffer.from(organization.replaceAll('-',''),'hex').copy(b,3);Buffer.from(project.replaceAll('-',''),'hex').copy(b,19);b[35]=Number(filter!==null);if(filter)Buffer.from(filter.replaceAll('-',''),'hex').copy(b,36);b.writeBigInt64BE(BigInt(Date.parse(entry.createdAt.slice(0,19)+'Z')/1000),52);b.writeInt32BE(Number((entry.createdAt.split('.')[1]?.replace('Z','')??'').padEnd(9,'0')),60);Buffer.from(entry.id.replaceAll('-',''),'hex').copy(b,64);return b.toString('base64url')}
const page=(entries:unknown[]=[row(3),row(2)],nextCursor:string|null=null,filter:string|null=null)=>({contract:'project-receipt-history-v1',signatureVerificationPerformed:false,organizationId:org,projectId:project,campaignId:filter,entries,nextCursor,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false});
test('receipt history verifies exact microseconds and the actual last-row boundary',()=>{
 const entries=Array.from({length:25},(_,i)=>row(30-i));assert.equal(receiptHistoryPage(page(entries,cursor(entries.at(-1)!)),user).entries.length,25);
 assert.equal(receiptHistoryPage(page([row(5)]),user,null,cursor(row(6))).entries[0].id,row(5).id);
 assert.equal(receiptHistoryPage(page([row(6,'2026-10-11T05:00:00.123455Z')]),user,null,cursor(row(6))).entries.length,1);
 assert.throws(()=>receiptHistoryPage(page([row(6)]),user,null,cursor(row(6))));assert.throws(()=>receiptHistoryPage(page(entries,cursor(row(5))),user));
});
test('receipt campaign filter is bound to rows page and requested navigation',()=>{
 const entries=Array.from({length:25},(_,i)=>row(30-i));assert.equal(receiptHistoryPage(page(entries,cursor(entries.at(-1)!,campaign),campaign),user,campaign).entries.length,25);
 assert.throws(()=>receiptHistoryPage(page(entries,cursor(entries.at(-1)!),campaign),user,campaign));
 assert.throws(()=>receiptHistoryPage(page(entries,cursor(entries.at(-1)!,campaign)),user));
 assert.throws(()=>receiptHistoryPage(page([{...row(3),campaignId:org}],null,campaign),user,campaign));
 assert.throws(()=>receiptHistoryPage(page([],null,campaign),user,campaign,cursor(row(3))));
 assert.throws(()=>receiptHistoryPage(page([],null,campaign),user,campaign,cursor(row(3),campaign,project)));
});
test('receipt history refuses duplicate order malformed time forged authority and noncanonical cursors',()=>{
 for(const invalid of [{...page(),organizationId:campaign},{...page(),projectId:campaign},{...page(),deploymentAuthority:true},{...page(),limit:250},page([row(3),row(3)]),page([row(2),row(3)]),page([row(3,'2026-02-30T05:00:00Z')]),page([row(3,'2026-10-11T05:00:00.123456001Z')]),page([{...row(3),keyId:'invalid'}]),page([{...row(3),secret:'hidden'}]),page(Array.from({length:26},(_,i)=>row(30-i)))])assert.throws(()=>receiptHistoryPage(invalid,user));
 const token=cursor(row(3)),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',noncanonical=token.slice(0,-1)+alphabet[alphabet.indexOf(token.at(-1)!)+1];
 assert.throws(()=>receiptHistoryPage(page(),user,null,noncanonical));const bytes=Buffer.from(token,'base64url');bytes.write('RUN');assert.throws(()=>receiptHistoryPage(page(),user,null,bytes.toString('base64url')));
 assert.throws(()=>receiptHistoryPage(page(),user,null,token+'='));
});
test('receipt history proxy admits only bounded authenticated read navigation',()=>{
 for(const segments of [['receipt-history'],['receipt-history','page',cursor(row(3))],['receipt-history','campaign',campaign],['receipt-history','campaign',campaign,'page',cursor(row(3),campaign)]]){
  assert.equal(proxyPath(segments,'GET'),'/api/'+segments.join('/'));for(const method of ['POST','PUT','DELETE'])assert.throws(()=>proxyPath(segments,method));
 }
 for(const segments of [['receipt-history','page','short'],['receipt-history','organization',org],['receipt-history','campaign',campaign,'page',cursor(row(3))+'=']])assert.throws(()=>proxyPath(segments,'GET'));
 assert.throws(()=>oauthQuery('/api/receipt-history',new URLSearchParams('organizationId='+org)));
});
