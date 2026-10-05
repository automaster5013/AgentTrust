import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {checkDemoRunCapacity} from './demo-run-capacity.mjs';

// Compare demo needs six retained runs; this check never reserves capacity.
export async function selectedDemoReadiness(organization,call){
 const scope=seededDemoScope(organization),report={...scope,status:'blocked',sessionScopeVerified:false,sessionLoggedOut:false,capacity:{status:'not_reached',requestedRuns:6}};
 let loginAttempted=false;
 try{
  const key=organization.credentials.find(key=>key.role==='admin')?.token;
  if(!key)throw Error('Selected administrator credential is unavailable');
  loginAttempted=true;await call('/v1/auth/login',{accessKey:key});
  assertDemoSessionScope(await call('/v1/me'),scope,'admin');report.sessionScopeVerified=true;
  const operations=await call('/v1/operations');report.capacity=checkDemoRunCapacity(operations,scope,6);
  report.workerRecent=operations?.worker?.state==='recent';
  if(report.capacity.status==='passed'&&report.workerRecent)report.status='passed';
 }catch{/* No response body, cookie, credential or raw error in readiness output. */}
 finally{
  if(loginAttempted)try{await call('/v1/auth/logout',{});report.sessionLoggedOut=true;}catch{/* Cleanup failure blocks readiness. */}
  else report.sessionLoggedOut=true;
  if(!report.sessionLoggedOut)report.status='blocked';
 }
 return report;
}
