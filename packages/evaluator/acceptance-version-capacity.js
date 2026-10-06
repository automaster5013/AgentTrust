import assert from 'node:assert/strict';
import {versionLimit} from '../contracts/index.js';
import {hash} from '../contracts/hash.js';
import {validateAcceptanceProfile} from './acceptance-profile.js';
export function planAcceptanceVersions(catalog,profile){
 const checked=validateAcceptanceProfile(profile);let requestedVersions=0;
 for(const kind of ['dataset','policy']){assert.ok(Array.isArray(catalog?.[kind])&&catalog[kind].length<=versionLimit);const expected=hash(checked[kind]);if(!catalog[kind].some(row=>row?.name===checked[kind].name&&row.contentHash===expected))requestedVersions++;}
 return requestedVersions;
}
export function checkAcceptanceVersionCapacity(operations,scope,requestedVersions){
 assert.ok(Number.isSafeInteger(requestedVersions)&&requestedVersions>=0&&requestedVersions<=2);const report={status:'invalid_capacity',requestedVersions};
 try{const c=operations?.versionCapacity;assert.equal(c.scope,'organization');assert.equal(c.organizationId,scope.organizationId);assert.ok(Number.isFinite(Date.parse(operations.observedAt)));assert.ok(Number.isSafeInteger(c.used)&&c.used>=0);assert.equal(c.limit,versionLimit);assert.equal(c.remaining,Math.max(0,c.limit-c.used));report.remainingVersions=c.remaining;report.status=c.remaining<requestedVersions?'insufficient_versions':'passed';}catch{}
 return report;
}
