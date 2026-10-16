import type {Reporter,TestCase,TestResult,FullResult} from '@playwright/test/reporter';
import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import {failureDiagnostics} from './failure-diagnostics.ts';
export default class SafeReporter implements Reporter {
 private tests:{title:string;status:string;phases:string[];sourceLine:string|null;failureCategory:string;failureDetails:ReturnType<typeof failureDiagnostics>[]}[]=[];
 onTestEnd(test:TestCase,result:TestResult){
  const message=result.error?.message??'';
  const failureCategory=!message?'none':/Executable doesn't exist|browserType\.launch/.test(message)?'browser-launch':/spawnSync.*ENOENT|spawn.*ENOENT/.test(message)?'missing-local-tool':/Command failed:.*python/.test(message)?'quota-preflight-command':/strict mode violation/.test(message)?'strict-locator':/Test timeout/.test(message)?'test-timeout':/toBeVisible/.test(message)?'visibility-assertion':/toHaveCount/.test(message)?'count-assertion':/toContainText/.test(message)?'text-assertion':/toBe\(/.test(message)?'value-assertion':'unclassified';
  this.tests.push({title:test.title,status:result.status,phases:test.annotations.filter(a=>a.type==='phase').map(a=>a.description??''),sourceLine:result.error?.stack?.match(/workspace\.spec\.ts:(\d+)/)?.[1]??null,failureCategory,failureDetails:result.errors.slice(0,4).map(failureDiagnostics)})
 }
 onEnd(result:FullResult){const directory=resolve(process.cwd(),'../../.local');mkdirSync(directory,{recursive:true});const report=resolve(directory,'stack-browser-'+randomUUID()+'.json');const value={completed:result.status==='passed',headlessFunctionalTests:true,readOnlyBrowserNetworkGuard:process.env.STACK_E2E_READ_ONLY==='true',visualReviewPerformed:false,credentialsRecorded:false,tests:this.tests};writeFileSync(report,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({completed:value.completed,tests:this.tests.length,failed:this.tests.filter(t=>t.status!=='passed').map(t=>t.title),reportPath:report}))}
}
