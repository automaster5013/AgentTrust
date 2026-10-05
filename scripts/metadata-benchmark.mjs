import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {parseMetadataBenchmarkArgs,runMetadataBenchmark} from './metadata-benchmark-scenario.mjs';
const reportPath='.local/metadata-benchmark-'+randomUUID()+'.json';
let cookie,base,scope,organizationIndex=0,sessionScopeVerified=false,report={schemaVersion:1,completed:false,readOnlyMetadata:true,serverDeployed:false};
async function call(path,data){
  const response=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui',...(scope?{'X-AgentTrust-Project':scope.projectId}:{}),...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!response.ok){await response.body?.cancel();throw new Error('Local metadata request failed.');}
  return readReleaseResponse(response);
}
try{
  const options=parseMetadataBenchmarkArgs(process.argv.slice(2));organizationIndex=options.organizationIndex;base=localSmokeBase();
  const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,''));
  const organization=config.organizations?.[organizationIndex];scope=seededDemoScope(organization);
  const key=organization.credentials.find(c=>c.role==='viewer')?.token;
  if(!key)throw new Error('Local viewer setup is missing.');
  const startedAt=new Date().toISOString();await call('/v1/auth/login',{accessKey:key});
  if(!cookie)throw new Error('Local viewer session is missing.');
  assertDemoSessionScope(await call('/v1/me'),scope,'viewer');sessionScopeVerified=true;
  report={...await runMetadataBenchmark({call,...options}),startedAt,finishedAt:new Date().toISOString(),syntheticLocalSetup:true};
}catch{report.completed=false;report.failed=true;}
finally{
  Object.assign(report,{organizationIndex,...(scope||{}),sessionScopeVerified});
  report.sessionLoggedOut=!cookie;
  if(cookie)try{await call('/v1/auth/logout',{});report.sessionLoggedOut=true;}catch{report.sessionLoggedOut=false;}
  try{await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}catch{report.reportWriteFailed=true;}
  const passed=report.completed&&report.sessionLoggedOut&&!report.reportWriteFailed;
  console.log(JSON.stringify({status:passed?'passed':'blocked',readOnlyMetadata:true,organizationIndex,sessionScopeVerified,sessionLoggedOut:report.sessionLoggedOut,reportPath,...(passed?{concurrency:report.concurrency,maximumInFlightRequests:report.maximumInFlightRequests,results:report.results}:{})}));
  if(!passed){console.error('Local metadata benchmark did not complete. Check local setup and private report.');process.exitCode=1;}
}
