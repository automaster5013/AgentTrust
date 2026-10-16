import test from 'node:test';
import assert from 'node:assert/strict';
import {failureDiagnostics} from '../e2e/failure-diagnostics.ts';
test('browser failure diagnostics distinguish protocol bodies and JSON without exporting private text',()=>{
 const secret='PRIVATE-DIAGNOSTIC-CANARY';
 const protocol=failureDiagnostics({name:'Error',message:'response.json: Protocol error (Network.getResponseBody): No resource with given identifier '+secret});
 assert.equal(protocol.responseBodyUnavailable,true);assert.equal(protocol.jsonParse,false);
 const json=failureDiagnostics({name:'SyntaxError',message:'Unexpected end of JSON input '+secret});
 assert.equal(json.jsonParse,true);assert.equal(json.errorKind,'SyntaxError');
 assert.ok(!JSON.stringify([protocol,json]).includes(secret));
 assert.ok(Object.entries(protocol).every(([key,value])=>key==='errorKind'?value==='Error':typeof value==='boolean'));
});
test('unknown exception names and messages cannot introduce output fields or raw values',()=>{
 const value=failureDiagnostics({name:'PRIVATE-NAME',message:'PRIVATE-MESSAGE https://private.invalid/?token=PRIVATE'});
 assert.equal(value.errorKind,'other');assert.ok(!JSON.stringify(value).includes('PRIVATE'));
 assert.equal(failureDiagnostics().errorKind,'none');
});
