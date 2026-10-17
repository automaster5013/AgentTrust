import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticRequestKind,diagnosticFailure,sanitizedNetworkDiagnostic} from '../e2e/network-diagnostics.ts';

test('network diagnostics preserve response lifecycle and timing without URL credentials or bodies',()=>{
 const secret='PRIVATE-NETWORK-CANARY';
 const kind=diagnosticRequestKind('http://127.0.0.1:4320/backend/login/oauth2/code/keycloak?code='+secret,'GET');
 const value=sanitizedNetworkDiagnostic({kind,event:'failed',status:200,failure:diagnosticFailure('net::ERR_ABORTED'),timing:{responseStart:29.12345,responseEnd:-1,startTime:Date.now(),private:secret},url:secret,body:secret,error:secret});
 assert.deepEqual(value,{kind:'oidc-callback',event:'failed',status:200,failure:'aborted',timing:{responseStart:29.123,responseEnd:-1}});
 assert.ok(!JSON.stringify(value).includes(secret));
 assert.equal(diagnosticRequestKind('http://private:secret@127.0.0.1:4320/backend/me','GET'),null);
 assert.equal(diagnosticRequestKind('https://private.invalid/backend/me','GET'),null);
 assert.equal(diagnosticRequestKind('http://127.0.0.1:4320/backend/campaigns','GET'),null);
});
test('unknown labels and nonfinite or unbounded timing values cannot escape the fixed schema',()=>{
 assert.equal(sanitizedNetworkDiagnostic({kind:'PRIVATE',event:'response'}),null);
 assert.equal(sanitizedNetworkDiagnostic({kind:'campaign-review',event:'PRIVATE'}),null);
 assert.deepEqual(sanitizedNetworkDiagnostic({kind:'campaign-admission',event:'response',status:999,failure:'PRIVATE',timing:{responseStart:Infinity,responseEnd:300001,requestStart:-2,connectEnd:0}}),{kind:'campaign-admission',event:'response',status:null,failure:'other',timing:{connectEnd:0}});
 assert.equal(diagnosticFailure('PRIVATE-ERROR'), 'other');
});
