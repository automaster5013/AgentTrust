import test from 'node:test';
import assert from 'node:assert/strict';
import {sequencePagination,sequencePageResult} from '../apps/api/pagination.js';
const context={organizationId:'organization',projectId:'project',cursorScope:'run-scope'};
const encoded=order=>Buffer.from(JSON.stringify({organizationId:context.organizationId,projectId:context.projectId,scope:context.cursorScope,order})).toString('base64url');
test('review cursor preserves bigint order beyond JavaScript safe integers',()=>{
 for(const order of ['9007199254740993','9223372036854775807'])assert.equal(sequencePagination(new URLSearchParams({limit:'1',cursor:encoded(order)}),context).cursor.order,order);
 const page=sequencePageResult([{id:'first',cursor_order:'9007199254740993'},{id:'second',cursor_order:'9007199254740992'}],{limit:1},context);assert.deepEqual(page.items,[{id:'first'}]);assert.equal(sequencePagination(new URLSearchParams({cursor:page.nextCursor}),context).cursor.order,'9007199254740993');
});
test('review cursor rejects malformed, overflowing and foreign sequence positions',()=>{
 for(const order of [0,'0','-1','1.1','01','9223372036854775808','99999999999999999999'])assert.throws(()=>sequencePagination(new URLSearchParams({cursor:encoded(order)}),context),/Invalid or foreign review cursor/);
 for(const changed of [{...context,projectId:'other'},{...context,organizationId:'other'},{...context,cursorScope:'other-run'}])assert.throws(()=>sequencePagination(new URLSearchParams({cursor:encoded('1')}),changed),/Invalid or foreign review cursor/);
 for(const query of ['limit=101','limit=1&limit=2','cursor=a&cursor=b','limit=1&sort=clock','cursor=%%%'])assert.throws(()=>sequencePagination(new URLSearchParams(query),context));
 assert.equal(sequencePagination(new URLSearchParams(),context),undefined);
});
