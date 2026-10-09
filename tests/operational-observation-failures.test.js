import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {observationFailure,observationHttpFailure,safeObservationFailureCode} from '../packages/operations/observation-failure.js';
import {observationRequest} from '../scripts/observation-request.mjs';
import {observeAlertSession} from '../scripts/operational-observation.mjs';
import {inspectOperationalObservation} from '../packages/operations/observation-evidence.js';

const scope={organizationId:randomUUID(),projectId:randomUUID()},options={organizationIndex:0,samples:1,intervalSeconds:1},at=new Date('2026-10-09T14:00:00.000Z');
const assessment=()=>({schemaVersion:1,status:'ok',...scope,observedAt:at.toISOString(),alerts:[],readOnly:true,automatedRemediationPerformed:false,releasePermissionVerified:false,continuousMonitoringProven:false});
const deps=()=>({login:async()=>{},me:async()=>({...scope,role:'admin'}),call:async()=>assessment(),logout:async()=>true,checkpoint:async()=>{},now:()=>at});
const code=expected=>error=>{assert.equal(safeObservationFailureCode(error),expected);assert.doesNotMatch(error.message,/PRIVATE/);return true;};

test('only owned safe errors supply diagnostic codes; arbitrary properties and messages are not read',()=>{
 const owned=observationFailure('authentication-denied');owned.code='PRIVATE';owned.message='PRIVATE';assert.equal(safeObservationFailureCode(owned),'authentication-denied');
 const forged={get code(){assert.fail('Do not inspect arbitrary error fields');},get message(){assert.fail('Do not inspect arbitrary error text');}};assert.equal(safeObservationFailureCode(forged),'operation-failed');assert.equal(safeObservationFailureCode('PRIVATE'),'operation-failed');assert.throws(()=>observationFailure('PRIVATE'));assert.throws(()=>safeObservationFailureCode(null,'PRIVATE'));
});

test('HTTP diagnostics distinguish authentication, access, rate limiting, service and other rejection',()=>{
 for(const [status,expected] of [[401,'authentication-denied'],[403,'access-denied'],[429,'rate-limited'],[500,'service-unavailable'],[503,'service-unavailable'],[599,'service-unavailable'],[400,'request-rejected'],[404,'request-rejected'],[302,'request-rejected']])assert.equal(safeObservationFailureCode(observationHttpFailure(status)),expected);
 for(const status of [0,600,'401',NaN])assert.throws(()=>observationHttpFailure(status));
});

test('rejected HTTP response bodies are cancelled without being read or copied to diagnostics',async()=>{
 let cancelled=0,reads=0;const response={ok:false,status:429,body:{cancel:async()=>{cancelled++;}}};await assert.rejects(observationRequest('http://127.0.0.1:4310','/v1/operations-alerts',{}, {fetchRequest:async()=>response,readResponse:async()=>{reads++;throw Error('PRIVATE');}}),code('rate-limited'));assert.equal(cancelled,1);assert.equal(reads,0);
});

test('request timeout, transport failure and caller interruption have bounded diagnostic codes',async()=>{
 for(const [error,expected] of [[Object.assign(Error('PRIVATE'),{name:'TimeoutError'}),'request-timeout'],[Error('PRIVATE'),'transport-failed']])await assert.rejects(observationRequest('http://127.0.0.1:4310','/v1/me',{}, {fetchRequest:async()=>{throw error;}}),code(expected));
 const c=new AbortController();c.abort('PRIVATE');await assert.rejects(observationRequest('http://127.0.0.1:4310','/v1/me',{signal:c.signal},{fetchRequest:async()=>{throw Error('PRIVATE');}}),code('interrupted'));
});

test('observation transport refuses unrelated routes and non-loopback targets before any request',async()=>{
 let calls=0;await assert.rejects(observationRequest('http://127.0.0.1:4310','/v1/runs',{}, {fetchRequest:async()=>{calls++;}}));assert.equal(calls,0);await assert.rejects(observationRequest('https://example.invalid','/v1/me'),code('transport-failed'));
});

test('real loopback login response with malformed JSON preserves its cookie for own-session logout',async()=>{
 const cookie='agenttrust_session='+('a'.repeat(64));let loggedOut=false;
 const server=createServer((req,res)=>{if(req.url==='/v1/auth/login'){res.writeHead(200,{'Set-Cookie':cookie+'; HttpOnly','Content-Type':'application/json'});res.end('PRIVATE invalid JSON');}else if(req.url==='/v1/auth/logout'&&req.headers.cookie===cookie){loggedOut=true;res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');}else{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;let captured;
 try{await assert.rejects(observationRequest(base,'/v1/auth/login',{method:'POST'},{onResponse:r=>{captured=r.headers.get('set-cookie').split(';')[0];}}),code('response-invalid'));assert.equal(captured,cookie);await observationRequest(base,'/v1/auth/logout',{method:'POST',headers:{Cookie:captured}});assert.equal(loggedOut,true);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('sampling and cleanup errors are recorded separately without returning private response data',async()=>{
 const r=await observeAlertSession(options,scope,{...deps(),call:async()=>{throw observationHttpFailure(401);},logout:async()=>{throw observationHttpFailure(403);}});assert.equal(r.completed,false);assert.equal(r.failureStage,'sampling');assert.equal(r.failureCode,'authentication-denied');assert.equal(r.cleanupFailureCode,'access-denied');assert.equal(r.sessionLoggedOut,false);const result=inspectOperationalObservation(r,scope);assert.equal(result.status,'incomplete');assert.equal(result.recordedFailureCode,'authentication-denied');assert.equal(result.recordedCleanupFailureCode,'access-denied');assert.equal(result.diagnosticAuthenticityVerified,false);assert.equal(result.currentReleasePermissionVerified,false);
});

test('scope, response, journal and unknown errors produce distinct safe diagnostics while cleaning up',async()=>{
 const variations=[{me:async()=>({...scope,role:'viewer'}),expected:'session-scope-invalid'},{call:async()=>({...assessment(),organizationId:randomUUID()}),expected:'response-invalid'},{checkpoint:async()=>{throw Error('PRIVATE');},expected:'checkpoint-write-failed'},{call:async()=>{throw Error('PRIVATE credentials');},expected:'operation-failed'}];
 for(const {expected,...change} of variations){const r=await observeAlertSession(options,scope,{...deps(),...change});assert.equal(r.failureCode,expected);assert.equal(r.completed,false);assert.equal(r.sessionLoggedOut,true);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|credentials/);if(expected==='checkpoint-write-failed'){assert.equal(r.reportWriteFailureCode,'checkpoint-write-failed');assert.equal(r.reportWriteFailed,true);}}
});

test('unconfirmed cleanup and interruption during logout remain incomplete with a safe explanation',async()=>{
 const unconfirmed=await observeAlertSession(options,scope,{...deps(),logout:async()=>false});assert.equal(unconfirmed.cleanupFailureCode,'session-cleanup-unconfirmed');assert.equal(inspectOperationalObservation(unconfirmed).status,'incomplete');
 const c=new AbortController();const interrupted=await observeAlertSession(options,scope,{...deps(),signal:c.signal,logout:async()=>{c.abort('PRIVATE');return true;}});assert.equal(interrupted.failureCode,'interrupted');assert.equal(interrupted.sessionLoggedOut,true);assert.equal(interrupted.completed,false);assert.equal(inspectOperationalObservation(interrupted).recordedFailureCode,'interrupted');
});

test('offline diagnostics reject arbitrary text and contradictory success or cleanup claims',async()=>{
 const successful=await observeAlertSession(options,scope,deps());for(const change of [{failureCode:'PRIVATE'},{failureCode:'authentication-denied'},{cleanupFailureCode:'access-denied'},{reportWriteFailureCode:'checkpoint-write-failed'}])assert.throws(()=>inspectOperationalObservation({...successful,...change}));
 const failed=await observeAlertSession(options,scope,{...deps(),call:async()=>{throw observationHttpFailure(401);}});assert.throws(()=>inspectOperationalObservation({...failed,failureCode:'interrupted'}));assert.throws(()=>inspectOperationalObservation({...failed,reportWriteFailed:true,reportWriteFailureCode:'transport-failed'}));
});
