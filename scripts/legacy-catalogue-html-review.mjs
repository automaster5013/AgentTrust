import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {legacyCatalogueHtmlFromFiles} from '../packages/stack-legacy-link/catalogue-report.js';
assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--render-only');
const root=resolve('.'),base=join(root,'.local');await mkdir(base,{recursive:true});
const output=await mkdtemp(join(base,'legacy-catalogue-html-review-')),inputs=join(output,'inputs');await mkdir(inputs);
const id=n=>'abcdef00-0000-4000-8000-'+String(n).padStart(12,'0'),sha=v=>createHash('sha256').update(v).digest('hex');
const pair=generateKeyPairSync('ed25519'),publicPem=pair.publicKey.export({type:'spki',format:'pem'}),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
await writeFile(join(inputs,'public.pem'),publicPem);const entries=[];
for(const [index,decision] of ['pass','block'].entries()){
 const artifact={schemaVersion:1,receiptId:id(index+1),organizationId:id(10),projectId:id(11),checkedAt:'2026-10-08T00:00:00.000Z',request:{candidateRunId:id(index+20)},result:{runId:id(index+20),decision,deploymentAllowed:decision==='pass',reasons:decision==='pass'?[]:['SYNTHETIC_PRIVATE_REASON_NOT_FOR_REPORT']},evidence:{candidate:{runId:id(index+20),snapshotHash:'a'.repeat(64),resultHash:'b'.repeat(64)}}};
 const raw=JSON.stringify({artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)})+'\n';await writeFile(join(inputs,'receipt-'+index+'.json'),raw);
 const mapping={schemaVersion:1,sourcePlatform:'agenttrust-4310',targetPlatform:'agenttrust-4320',sourceOrganizationId:id(10),sourceProjectId:id(11),targetOrganizationId:id(30),targetProjectId:id(31),sourceReceiptId:artifact.receiptId,sourceArtifactHash:hash(artifact),sourceReceiptBytesSha256:sha(raw),sourceSigningKeyId:signer.keyId};
 const mappingRaw=JSON.stringify(mapping)+'\n';await writeFile(join(inputs,'mapping-'+index+'.json'),mappingRaw);entries.push({receiptFile:'receipt-'+index+'.json',trustedKeyFile:'public.pem',mappingFile:'mapping-'+index+'.json',mappingSha256:sha(mappingRaw)});
}
const raw=JSON.stringify({schemaVersion:1,kind:'legacy-receipt-link-catalogue',entries})+'\n',catalogueFile=join(inputs,'catalogue.json');await writeFile(catalogueFile,raw);
const html=await legacyCatalogueHtmlFromFiles({catalogueFile,expectedCatalogueSha256:sha(raw),expectedTarget:{organizationId:id(30),projectId:id(31)}});assert.ok(!html.includes('SYNTHETIC_PRIVATE_REASON_NOT_FOR_REPORT'));await writeFile(join(output,'preview.html'),html);
const report={completed:false,syntheticFixture:true,actualSourceFilesVerified:true,operatingDataAccessed:false,businessWrites:false,apiConnected:false,checks:[]};
if(process.argv.includes('--render-only')){await writeFile(join(output,'summary.json'),JSON.stringify({...report,rendered:true},null,2)+'\n');console.log(JSON.stringify({rendered:true,syntheticFixture:true,visualReviewPerformed:false,output}));}
else{
 let browser;
 try{
  if(process.platform==='win32')execFileSync('python',['-c',"import sys;sys.path.insert(0,'scripts');from stack_host_capacity import require_host_capacity;require_host_capacity(2048)"],{cwd:root,stdio:'pipe',timeout:10000});
  const req=createRequire(join(root,'apps/console/package.json')),{chromium,expect}=req('@playwright/test');browser=await chromium.launch({headless:true});
  for(const width of [320,390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
   await expect(page.getByRole('heading',{name:'기존 서명 기록 사전검사',exact:true})).toBeVisible();await expect(page.getByText('현재 배포 권한 없음 · 자료 가져오기 없음',{exact:true})).toBeVisible();assert.equal(await page.locator('script,iframe,object,embed,form,a,img').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const region=page.getByRole('region',{name:'기존 기록 검증 표 · 좌우 이동',exact:true});await region.focus();await expect(region).toBeFocused();const overflowing=await region.evaluate(n=>n.scrollWidth>n.clientWidth);
   if(overflowing){await page.keyboard.press('ArrowRight');await expect.poll(()=>region.evaluate(n=>n.scrollLeft)).toBeGreaterThan(0);}
   await region.evaluate(n=>n.scrollTo({left:0,behavior:'instant'}));await page.screenshot({path:join(output,'report-'+width+'.png'),fullPage:true});assert.equal(requests,0);report.checks.push({width,pageHorizontalOverflow:false,tableKeyboardReachable:true,tableKeyboardScrolled:overflowing,externalRequests:0});await page.close();
  }
  report.completed=true;
 }catch(error){report.errorType=error.name;process.exitCode=1;}
 finally{if(browser)await browser.close();await writeFile(join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,output}));}
}
