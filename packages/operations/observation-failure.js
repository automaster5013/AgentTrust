import assert from 'node:assert/strict';

export const observationFailureCodes=Object.freeze(['interrupted','authentication-denied','access-denied','rate-limited','service-unavailable','request-rejected','request-timeout','transport-failed','response-invalid','session-scope-invalid','session-unconfirmed','checkpoint-write-failed','session-cleanup-unconfirmed','operation-failed']);
const codes=new Set(observationFailureCodes),owned=new WeakMap();
export function observationFailure(code){
 assert.ok(codes.has(code));const error=new Error('Bounded operational observation failed.');owned.set(error,code);return error;
}
export function safeObservationFailureCode(error,fallback='operation-failed'){
 assert.ok(codes.has(fallback));return error&&typeof error==='object'?owned.get(error)??fallback:fallback;
}
export function observationHttpFailure(status){
 assert.ok(Number.isInteger(status)&&status>=100&&status<=599);
 return observationFailure(status===401?'authentication-denied':status===403?'access-denied':status===429?'rate-limited':status>=500?'service-unavailable':'request-rejected');
}
