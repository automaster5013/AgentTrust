import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createPrivateKey,createPublicKey} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';

const checks=[['inputs','Node.js 24와 유효한 로컬 PORT를 사용하세요.'],['local-files','npm run setup으로 로컬 설정과 두 조직의 역할 키를 준비하세요. 기존 비밀 파일을 보존하세요.'],['signing-key-pair','기존 서명 키 쌍을 보존하고 setup 상태를 확인하세요.'],['compose-services','Docker Desktop을 실행하고 npm run docker:up으로 API·DB·워커를 준비하세요.'],['api-health','로컬 API 주소와 포트, DB 연결을 확인하세요.']];
export async function demoPreflight(stages){
  const report={schemaVersion:1,readOnly:true,status:'passed',checks:[]};let blocked=false;
  for(const [name,guidance] of checks){
    if(blocked){report.checks.push({name,status:'not_run'});continue;}
    try{await stages[name]();report.checks.push({name,status:'passed'});}
    catch{blocked=true;report.status='blocked';report.failedCheck=name;report.guidance=guidance;report.checks.push({name,status:'blocked'});}
  }
  return report;
}
export function verifyDemoCredentials(config){
  assert.ok(Array.isArray(config?.organizations)&&config.organizations.length===2);
  const ids=new Set(),tokens=new Set();
  for(const org of config.organizations){
    for(const id of [org.organizationId,org.projectId]){assert.match(id||'',/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);assert.ok(!ids.has(id));ids.add(id);}
    for(const role of ['admin','editor','viewer']){
      const keys=org.credentials.filter(k=>k.role===role);assert.equal(keys.length,1);assert.match(keys[0].token||'',/^[a-f0-9]{64}$/);assert.ok(!tokens.has(keys[0].token));tokens.add(keys[0].token);
    }
  }
}
export function verifyDemoServices(rows,port){
  for(const service of ['api','db','worker']){
    const matches=rows.filter(r=>r.Service===service);assert.equal(matches.length,1);assert.equal(matches[0].State,'running');
    if(service!=='worker')assert.equal(matches[0].Health,'healthy');
    else assert.ok(!matches[0].Health||matches[0].Health==='healthy');
  }
  const bindings=rows.find(r=>r.Service==='api').Publishers||[];
  assert.ok(bindings.some(p=>p.URL==='127.0.0.1'&&p.PublishedPort===Number(port)&&p.TargetPort===4310));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=process.env.PORT??'4310';let base;
  const report=await demoPreflight({
    inputs:async()=>{assert.equal(process.argv.length,2);assert.equal(process.versions.node.split('.')[0],'24');base=localSmokeBase(port);},
    'local-files':async()=>{assert.ok((await stat('.env')).isFile());const bytes=await readFile('.local/credentials.json');assert.ok(bytes.length<=65536);verifyDemoCredentials(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));},
    'signing-key-pair':async()=>{const privateKey=createPrivateKey(await readFile('.local/receipt-signing/private.pem'));assert.equal(privateKey.asymmetricKeyType,'ed25519');const expected=createPublicKey(privateKey).export({type:'spki',format:'pem'});assert.equal(expected,createPublicKey(await readFile('.local/receipt-signing/public.pem')).export({type:'spki',format:'pem'}));},
    'compose-services':async()=>{const output=execFileSync('docker',['compose','ps','--format','json'],{encoding:'utf8',timeout:15000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']}).trim();const rows=output.startsWith('[')?JSON.parse(output):output.split('\n').filter(Boolean).map(line=>JSON.parse(line));verifyDemoServices(rows,port);},
    'api-health':async()=>{const response=await fetchLocalSmoke(base,'/health',{signal:AbortSignal.timeout(5000)});if(response.status!==200){await response.body?.cancel();throw Error('Local health request failed');}const result=await response.json();assert.equal(result.status,'ok');assert.equal(result.mode,'local-mock');assert.equal(result.persistent,true);}
  });
  console.log(JSON.stringify(report));if(report.status!=='passed')process.exitCode=1;
}
