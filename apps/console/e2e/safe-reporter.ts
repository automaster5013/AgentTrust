import type {Reporter,TestCase,TestResult,FullResult} from '@playwright/test/reporter';
import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';
export default class SafeReporter implements Reporter {
 private tests:{title:string;status:string;phases:string[];sourceLine:string|null}[]=[];
 onTestEnd(test:TestCase,result:TestResult){this.tests.push({title:test.title,status:result.status,phases:test.annotations.filter(a=>a.type==='phase').map(a=>a.description??''),sourceLine:result.error?.stack?.match(/workspace\.spec\.ts:(\d+)/)?.[1]??null})}
 onEnd(result:FullResult){const directory=resolve(process.cwd(),'../../.local');mkdirSync(directory,{recursive:true});const report=resolve(directory,'stack-browser-'+randomUUID()+'.json');const value={completed:result.status==='passed',headlessFunctionalTests:true,visualReviewPerformed:false,credentialsRecorded:false,tests:this.tests};writeFileSync(report,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({completed:value.completed,tests:this.tests.length,failed:this.tests.filter(t=>t.status!=='passed').map(t=>t.title),reportPath:report}))}
}
