import assert from 'node:assert/strict';
import {validate} from '../packages/contracts/index.js';
import {hash} from '../packages/contracts/hash.js';
export {acceptanceModes,validateAcceptanceProfile} from '../packages/evaluator/acceptance-profile.js';
export async function ensureAcceptanceVersion({call,catalog,kind,data}){
 assert.ok(['dataset','policy'].includes(kind));assert.ok(Array.isArray(catalog)&&catalog.length<=1000);data=validate(kind,data);const contentHash=hash(data);
 const existing=catalog.find(row=>row?.contentHash===contentHash&&row.name===data.name);
 const row=existing||await call('/v1/'+kind+'-versions',data);
 assert.match(row?.id||'',/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);assert.equal(row.contentHash,contentHash);
 const stored=await call('/v1/versions/'+row.id);assert.equal(stored.id,row.id);assert.equal(stored.kind,kind);assert.equal(stored.contentHash,contentHash);assert.equal(hash(validate(kind,stored.data)),contentHash);
 return {id:row.id,contentHash,reused:Boolean(existing)};
}
