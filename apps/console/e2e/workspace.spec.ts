import {test,expect,type Page} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync} from 'node:fs';import {resolve} from 'node:path';
import {auditFilters} from '../src/lib/audit-search';
import {uncertainCampaignWrite} from '../src/lib/campaign-write-error';
import {uncertainEvaluationWrite} from '../src/lib/evaluation-request';
async function existingSyntheticEvaluation(page:Page,passOnly=false){
 const response=await page.request.get('/backend/runs');expect(response.status()).toBe(200);const rows=await response.json() as {id:string;provider:string;scenario:string;state:string;decision:string}[];
 const row=rows.find(r=>r.provider==='synthetic'&&r.scenario!=='quality'&&r.state!=='queued'&&(!passOnly||r.decision==='pass'));expect(row).toBeTruthy();
 const record=await (await page.request.get('/backend/runs/'+row!.id)).json(),me=await (await page.request.get('/backend/me')).json(),gate=await (await page.request.get('/backend/runs/'+row!.id+'/gate')).json();return {record,me,gate};
}
async function prepareSyntheticEvaluationForm(page:Page,record:{scenario:string;provider:string;requires_approval:boolean}){
 await page.getByLabel('합성 시나리오',{exact:true}).selectOption(record.scenario);await page.getByLabel('실행 공급자',{exact:true}).selectOption(record.provider);await page.getByLabel('관리자 승인 필요',{exact:true}).setChecked(record.requires_approval);
}
async function existingRecoverableCampaign(page:Page){
 const agents=await page.getByLabel('캠페인 에이전트 버전',{exact:true}).locator('option').evaluateAll(rows=>rows.map(row=>(row as HTMLOptionElement).value)),datasets=await page.getByLabel('캠페인 데이터셋 버전',{exact:true}).locator('option').evaluateAll(rows=>rows.map(row=>(row as HTMLOptionElement).value));
 const rows=await (await page.request.get('/backend/campaigns')).json();
 for(const row of rows){if(!agents.includes(row.agent_version_id)||!datasets.includes(row.dataset_version_id))continue;const record=await (await page.request.get('/backend/campaigns/'+row.id)).json(),requirements=await (await page.request.get('/backend/campaigns/'+row.id+'/release-requirements')).json(),lifecycle=await (await page.request.get('/backend/campaigns/'+row.id+'/version-lifecycle')).json();if(record.state!=='queued'&&record.agentVersion.definition.provider==='synthetic'&&!requirements.enabled&&lifecycle.versions.every((v:{state:string})=>v.state==='active')){await page.getByLabel('캠페인 에이전트 버전',{exact:true}).selectOption(record.agent_version_id);await page.getByLabel('캠페인 데이터셋 버전',{exact:true}).selectOption(record.dataset_version_id);await page.getByLabel('캠페인 관리자 승인 필요',{exact:true}).setChecked(record.requires_approval);return {record,requirements,me:await (await page.request.get('/backend/me')).json()}}}
 throw Error('Existing recoverable synthetic campaign unavailable');
}

test('authenticated viewer preserves identity during evaluation list failure and retries only the read',async({page})=>{
 let mode='unavailable',writes=0;const list='**/backend/runs';
 let releaseFirstList!:()=>void,firstList=true;const initialList=new Promise<void>(resolve=>{releaseFirstList=resolve});
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/backend/')&&request.method()==='POST'&&!['/backend/login','/backend/logout'].includes(path))writes++});
 try{
  await login(page,'demo-viewer',()=>page.route(list,async route=>{if(firstList){firstList=false;await initialList}return mode==='actual'?route.continue():route.fulfill({status:mode==='expired'?401:503,contentType:'application/json',body:JSON.stringify({code:mode==='expired'?'AUTHENTICATION_REQUIRED':'SERVICE_UNAVAILABLE'})})}));
  await expect(page.getByText('로그인 상태를 확인하고 있습니다.',{exact:true})).toHaveCount(0);releaseFirstList();
  const failure=page.getByRole('status',{name:'최근 평가 조회 상태',exact:true});await expect(failure).toContainText('평가 목록을 확인하지 못했습니다.');
  await expect(page.getByRole('button',{name:'Keycloak으로 로그인',exact:true})).toHaveCount(0);await expect(page.getByText('저장된 평가가 없습니다.',{exact:true})).toHaveCount(0);
  mode='actual';await page.getByRole('button',{name:'최근 평가 다시 조회',exact:true}).click();await expect(failure).toHaveCount(0);await expect(page.getByRole('list',{name:'최근 평가 목록',exact:true})).toBeVisible();
  phase('actual Keycloak identity survives an intercepted list 503; explicit read retry restores existing evaluations without login or business writes');
  mode='expired';await page.getByRole('button',{name:'최근 평가 다시 조회',exact:true}).click();await expect(page.getByRole('button',{name:'Keycloak으로 로그인',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toHaveCount(0);await expect(page.getByRole('list',{name:'최근 평가 목록',exact:true})).toHaveCount(0);expect(writes).toBe(0);
  phase('an intercepted list 401 clears identity, records and protected workspace instead of retaining authenticated UI');
 }finally{releaseFirstList();await page.unroute(list)}
});

test('viewer resolves receipt-specific historical signing trust and rejects substituted or unavailable public keys without writes',async({page})=>{
 await login(page,'demo-viewer');
 const rows=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];let campaignId='',receiptId='';
 for(const row of rows){const response=await page.request.get('/backend/campaigns/'+row.id+'/receipts');expect(response.status()).toBe(200);const receipts=await response.json() as {id:string}[];if(receipts.length){campaignId=row.id;receiptId=receipts[0].id;break}}
 expect(campaignId).not.toBe('');
 const receipt=await (await page.request.get('/backend/campaigns/'+campaignId+'/receipts/'+receiptId)).json();
 expect(receipt.keyId).toMatch(/^[a-f0-9]{64}$/);
 const trustResponse=await page.request.get('/backend/gate-trust/keys/'+receipt.keyId);expect(trustResponse.status()).toBe(200);const trust=await trustResponse.json();
 const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});await region.getByRole('button',{name:'캠페인 '+campaignId.slice(0,8),exact:true}).click();
 const history=page.getByRole('region',{name:'서명된 과거 판정',exact:true});await history.getByRole('button',{name:'서명 기록 목록 확인',exact:true}).click();
 const button=history.getByRole('button',{name:'서명 기록 '+receiptId.slice(0,8)+' 검증',exact:true}),verified=history.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true});
 let mode='actual',lookups=0,currentKeyFallbacks=0;const path='**/backend/gate-trust/keys/'+receipt.keyId,currentPath='**/backend/gate-trust';
 await page.route(path,route=>{lookups++;if(mode==='actual')return route.continue();if(mode==='unavailable')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'KEY_UNAVAILABLE'})});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...trust,keyId:'f'.repeat(64)})})});
 await page.route(currentPath,route=>{currentKeyFallbacks++;return route.continue()});
 try{
  await button.click();await expect(verified).toBeVisible();await expect(history.getByText('서명 키 '+receipt.keyId,{exact:true})).toBeVisible();expect(lookups).toBe(1);
  for(mode of ['substituted','unavailable']){await button.click();await expect(verified).toHaveCount(0);await expect(history.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true})).toHaveCount(0);await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('과거 판정의 서명과 보관 근거 연결을 확인하지 못했습니다.')}
  mode='actual';await button.click();await expect(verified).toBeVisible();const before=lookups,downloadEvent=page.waitForEvent('download');await history.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();const download=await downloadEvent;expect(await download.failure()).toBeNull();expect(lookups).toBe(before+1);expect(currentKeyFallbacks).toBe(0);
 }finally{await page.unroute(path);await page.unroute(currentPath)}
 phase('actual existing receipt and full bundle use the bounded receipt key lookup; substituted/unavailable trust clears proof and download; explicit retry recovers; no active-key fallback and no business/provider writes');
});

test('editor preserves uncertain campaign versions and conditions while explicitly retrying the original admission',async({page})=>{
 await login(page,'demo-editor');await expect(page.getByRole('button',{name:'캠페인 실행',exact:true})).toBeEnabled();const {record}=await existingRecoverableCampaign(page),create=page.getByRole('button',{name:'캠페인 실행',exact:true}),panel=page.getByRole('region',{name:'저장 결과가 불확실한 캠페인 요청',exact:true});
 let key='',original:unknown,posts=0,mode='stalled',release!:()=>void,entered!:()=>void,finished!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r),done=new Promise<void>(r=>finished=r),path='**/backend/campaigns',requirementsPath='**/backend/campaigns/'+record.id+'/release-requirements',gatePath='**/backend/campaigns/'+record.id+'/gate';
 await page.route(path,async route=>{if(route.request().method()!=='POST')return route.fallback();posts++;const request=route.request();if(posts===1){key=request.headers()['idempotency-key'];original=request.postDataJSON();expect(key).toMatch(/^[a-f0-9-]{36}$/)}else{expect(request.headers()['idempotency-key']).toBe(key);expect(request.postDataJSON()).toEqual(original)}if(mode==='stalled'){entered();await held;try{await route.abort('failed')}catch{/* owned timed-out request */}finally{finished()}return}if(mode==='refused')return route.fulfill({status:403,body:'fixture-private-refusal'});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(record)})});
 try{
  await create.click();await started;await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible({timeout:15000});release();await done;await expect(panel).toBeVisible();await expect(create).toBeDisabled();expect(posts).toBe(1);
  await page.getByLabel('캠페인 관리자 승인 필요',{exact:true}).setChecked(!record.requires_approval);await page.getByLabel('양쪽 근거 유효 기간',{exact:true}).fill('7200');const retry=panel.getByRole('button',{name:'같은 캠페인 요청 다시 제출',exact:true});
  mode='refused';await retry.click();await expect(page.getByText('권한 또는 요청 검증을 확인해 주세요.',{exact:true})).toBeVisible();await expect(panel).toBeVisible();await expect(create).toBeDisabled();expect(posts).toBe(2);
  mode='metadata';await page.route(requirementsPath,route=>route.fulfill({status:503,body:'fixture-private-requirements'}));await retry.click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();await expect(panel).toBeVisible();await expect(create).toBeDisabled();expect(posts).toBe(3);await page.unroute(requirementsPath);
  mode='confirmed';await page.route(gatePath,route=>route.fulfill({status:503,body:'fixture-private-gate'}));await retry.click();await expect(page.getByText('캠페인 요청의 저장 결과는 확인했지만 목록이나 현재 게이트를 확인하지 못했습니다.',{exact:false})).toBeVisible();await expect(panel).toHaveCount(0);await expect(create).toBeEnabled();expect(posts).toBe(4);await expect(page.getByText('fixture-private',{exact:false})).toHaveCount(0);
 }finally{release();await page.unroute(path);await page.unroute(requirementsPath);await page.unroute(gatePath)}
 phase('all campaign admission POSTs intercepted; actual10-second browser timeout preserves original actor version hashes approval baseline and age; edited form never changes retry body or key; explicit403 on a previously unknown request retains it; admission receipt followed by unavailable requirements remains unresolved; exact input and requirements verified before clearing pending state; later gate503 is distinct; no business mutation');
});

test('editor resolves an uncertain campaign using a scoped admission and verifies original versions and release conditions',async({page})=>{
 await login(page,'demo-editor');await expect(page.getByRole('button',{name:'캠페인 실행',exact:true})).toBeEnabled();const {record,requirements,me}=await existingRecoverableCampaign(page);let key='',posts=0,mode='missing';const createPath='**/backend/campaigns',lookupPath='**/backend/campaign-requests/*',readPath='**/backend/campaigns/'+record.id,requirementsPath='**/backend/campaigns/'+record.id+'/release-requirements';
 await page.route(createPath,route=>{if(route.request().method()!=='POST')return route.fallback();posts++;key=route.request().headers()['idempotency-key'];return route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private":'})});
 await page.route(lookupPath,route=>{expect(route.request().method()).toBe('GET');expect(route.request().url().endsWith('/'+key)).toBe(true);return route.fulfill({status:mode==='missing'?404:200,contentType:'application/json',body:JSON.stringify({requestKey:mode==='substituted'?randomUUID():key,organizationId:me.organizationId,projectId:me.projectId,actorId:me.actorId,campaignId:record.id,deploymentAuthority:false})})});
 await page.route(readPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mode==='changed-input'?{...record,requires_approval:!record.requires_approval}:record)}));
 await page.route(requirementsPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mode==='changed-requirements'?{...requirements,projectId:randomUUID()}:requirements)}));
 try{
  await page.getByRole('button',{name:'캠페인 실행',exact:true}).click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();const panel=page.getByRole('region',{name:'저장 결과가 불확실한 캠페인 요청',exact:true}),lookup=panel.getByRole('button',{name:'기존 캠페인 요청 조회',exact:true});
  for(const observation of ['missing','substituted','changed-input','changed-requirements']){mode=observation;await lookup.click();await expect(page.getByText(observation==='missing'?'현재 이 요청의 캠페인을 찾지 못했습니다.':'캠페인 요청의 저장 결과를 조회하지 못했습니다.',{exact:false})).toBeVisible();await expect(panel).toBeVisible();await expect(page.getByRole('button',{name:'캠페인 실행',exact:true})).toBeDisabled();expect(posts).toBe(1)}
  mode='valid';await lookup.click();await expect(panel).toHaveCount(0);await expect(page.getByText('버전에 연결된 캠페인을 저장했습니다.',{exact:true})).toBeVisible();expect(posts).toBe(1);await expect(page.getByText('fixture-private',{exact:false})).toHaveCount(0);
 }finally{await page.unroute(createPath);await page.unroute(lookupPath);await page.unroute(readPath);await page.unroute(requirementsPath)}
 phase('initial campaign POST and owned admission pointer are synthetic intercepted responses; actual immutable version hashes and release conditions read;404 substituted key changed approval and foreign requirements preserve unresolved intent; explicit correct lookup verifies exact scope record input and requirements without another POST; no business mutation');
});
if(process.env.STACK_E2E_READ_ONLY==='true')test('local read-only guard blocks a business mutation before backend dispatch',async({page})=>{
 await login(page,'demo-admin');const result=await page.evaluate(async()=>{try{await fetch('/backend/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'forbidden-guard-probe',requiresApproval:false})});return 'unexpected-network-response'}catch{return 'browser-network-blocked'}});expect(result).toBe('browser-network-blocked');expect(test.info().annotations.some(a=>a.type==='phase'&&a.description==='read-only network guard refused unintended business mutation')).toBe(true);phase('actual read-only browser guard blocks POST before dispatch; probe also omitsCSRF and uses invalid scenario as independent backend refusal protection; no business write');
});

for(const resource of ['runs','campaigns'] as const)test('administrator compares observed '+resource+' review sequence and refuses stale or unverified basis without forwarding writes',async({page})=>{
 await login(page,'demo-admin');let record:any;
 if(resource==='runs')record=(await existingSyntheticEvaluation(page,true)).record;
 else{const rows=await (await page.request.get('/backend/campaigns')).json();for(const row of rows){const value=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(value.decision==='pass'){record=value;break}}}
 expect(record).toBeTruthy();const prefix='/backend/'+resource+'/'+record.id,frame=await (await page.request.get(prefix+'/reviews/page')).json(),me=await (await page.request.get('/backend/me')).json(),gate=await (await page.request.get(prefix+'/gate')).json();
 const sequence=frame.entries[0]?.review_sequence??0,reason='Synthetic concurrent rejection must be read before resubmission',changed={...frame,entries:[{id:randomUUID(),actor_id:me.actorId,decision:'rejected',reason,created_at:new Date().toISOString(),review_sequence:sequence+1,policy_version:gate.policyVersion,policy_digest:gate.policyDigest}],nextCursor:null};
 let basisMode='original',posts=0,mode='conflict';const historyPath='**'+prefix+'/reviews/page',postPath='**'+prefix+'/reviews',gatePath='**'+prefix+'/gate';
 await page.route(historyPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(basisMode==='original'?frame:basisMode==='changed'?changed:{...changed,projectId:randomUUID()})}));
 await page.route(postPath,route=>{expect(route.request().method()).toBe('POST');posts++;const body=route.request().postDataJSON();expect(body.expectedReviewSequence).toBe(mode==='conflict'?sequence:sequence+1);if(mode==='conflict'){basisMode='changed';return route.fulfill({status:409,body:'fixture-private-conflict'})}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:randomUUID(),decision:body.decision})})});
 try{
  if(resource==='runs')await page.locator('.runs li button').filter({hasText:record.id.slice(0,8)}).click();else await page.getByRole('button',{name:'캠페인 '+record.id.slice(0,8),exact:true}).click();
  const region=page.getByRole('region',{name:'저장 전 검토 기준',exact:true}),button=page.getByRole('button',{name:resource==='runs'?'검토 저장·게이트 확인':'캠페인 검토 저장',exact:true});await expect(button).toBeEnabled();await page.getByLabel(resource==='runs'?'검토 사유':'캠페인 검토 사유',{exact:true}).fill('Synthetic intercepted conditional approval');await button.click();
  await expect(page.getByText('최신 검토 또는 평가 상태가 변경되어 저장하지 않았습니다. 검토 기준과 현재 게이트를 확인한 뒤 다시 제출해 주세요.',{exact:true})).toBeVisible();await expect(region.getByText(reason,{exact:true})).toBeVisible();await expect(button).toBeEnabled();expect(posts).toBe(1);
  mode='valid';await page.route(gatePath,route=>route.fulfill({status:503,body:'fixture-private-gate'}));await button.click();await expect(page.getByText(resource==='runs'?'검토 저장 결과는 확인했지만 현재 게이트를 확인하지 못했습니다.':'캠페인 검토 저장 결과는 확인했지만 현재 게이트를 확인하지 못했습니다.',{exact:false})).toBeVisible();expect(posts).toBe(2);
  basisMode='invalid';await region.getByRole('button',{name:'검토 기준 다시 조회',exact:true}).click();await expect(region.getByText('최신 검토 기준을 확인하지 못해 저장할 수 없습니다.',{exact:true})).toBeVisible();await expect(button).toBeDisabled();expect(posts).toBe(2);await expect(page.getByText('fixture-private',{exact:false})).toHaveCount(0);
 }finally{await page.unroute(historyPath);await page.unroute(postPath);await page.unroute(gatePath)}
 phase('existing scope read; synthetic latest rejection and all POST responses intercepted; exact observed sequence sent once,409 clears gate and refreshes visible basis without resubmission; explicit fresh retry and valid receipt distinguished from unavailable gate; substituted basis disables writes; no business mutation');
});

test('viewer verifies existing archived bytes and clears proof without creating an evaluation',async({page})=>{
 await login(page,'demo-viewer');const rows=await (await page.request.get('/backend/runs')).json() as {id:string;state:string}[];let id='',proof:{contentSha256:string;storageVersion:string}|null=null;
 for(const row of rows.filter(row=>row.state!=='queued')){const response=await page.request.get('/backend/runs/'+row.id+'/evidence');if(response.status()===200){id=row.id;proof=await response.json();break}expect(response.status()).toBe(409)}expect(id).not.toBe('');expect(proof).not.toBeNull();
 await page.locator('.runs button').filter({hasText:id.slice(0,8)}).click();await page.getByRole('button',{name:'근거 해시·버전 확인',exact:true}).click();await expect(page.getByText('SHA-256 '+proof!.contentSha256,{exact:true})).toBeVisible();await expect(page.getByText('저장 버전 '+proof!.storageVersion,{exact:true})).toBeVisible();const other=rows.find(row=>row.id!==id)!;await page.locator('.runs button').filter({hasText:other.id.slice(0,8)}).click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+other.id);await expect(page.getByText('SHA-256 '+proof!.contentSha256,{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'평가 실행',exact:true})).toBeDisabled();phase('existing immutable archive read and selection clearing verified as viewer; no evaluation creation and no business write');
});

test('editor preserves uncertain evaluation input and explicitly resubmits the same admission key',async({page})=>{
 await login(page,'demo-editor');const {record}=await existingSyntheticEvaluation(page);await prepareSyntheticEvaluationForm(page,record);let posts=0,key='',body:unknown=null;
 const path='**/backend/runs';await page.route(path,async route=>{if(route.request().method()!=='POST')return route.continue();posts++;const currentKey=route.request().headers()['idempotency-key'],currentBody=route.request().postDataJSON();if(posts===1){key=currentKey;body=currentBody;return route.abort('failed')}expect(currentKey).toBe(key);expect(currentBody).toEqual(body);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(record)})});
 try{
  const create=page.getByRole('button',{name:'평가 실행',exact:true});await create.click();await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toBeVisible();expect(posts).toBe(1);expect(key).toMatch(/^[a-f0-9-]{36}$/);
  const pending=page.getByRole('region',{name:'미확인 평가 요청',exact:true});await expect(pending).toBeVisible();await expect(create).toBeDisabled();await page.getByLabel('합성 시나리오',{exact:true}).selectOption(record.scenario==='pass'?'block':'pass');
  const lookup='**/backend/run-requests/'+key;await page.route(lookup,route=>route.fulfill({status:404,contentType:'application/json',body:'{}'}));try{await pending.getByRole('button',{name:'평가 요청 결과 다시 조회',exact:true}).click();await expect(page.getByText('현재 이 요청의 평가를 찾지 못했습니다.',{exact:false})).toBeVisible();expect(posts).toBe(1);await expect(pending).toBeVisible()}finally{await page.unroute(lookup)}
  await pending.getByRole('button',{name:'같은 평가 요청 다시 제출',exact:true}).click();await expect(page.locator('.evidence').getByText('실행 '+record.id,{exact:true})).toBeVisible();await expect(pending).toHaveCount(0);await expect(create).toBeEnabled();expect(posts).toBe(2);
 }finally{await page.unroute(path)}
 phase('POSTs intercepted and never forwarded; lost receipt holds immutable input and original key; read-only404 does not assert absence or resubmit; explicit second POST uses identical original payload/key despite edited form; synthetic receipt borrows an actual scoped read-only evaluation; no business or provider writes');
});
test('editor resolves an uncertain evaluation by scoped request lookup without another submission',async({page})=>{
 await login(page,'demo-editor');const {record,me}=await existingSyntheticEvaluation(page);await prepareSyntheticEvaluationForm(page,record);let key='',posts=0,mode='foreign';const createPath='**/backend/runs';
 await page.route(createPath,route=>{if(route.request().method()!=='POST')return route.continue();posts++;key=route.request().headers()['idempotency-key'];return route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private-receipt":'})});
 try{
  await page.getByRole('button',{name:'평가 실행',exact:true}).click();await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toBeVisible();expect(posts).toBe(1);const pending=page.getByRole('region',{name:'미확인 평가 요청',exact:true}),lookup='**/backend/run-requests/'+key,detailPath='**/backend/runs/'+record.id;
  const frame={requestKey:key,organizationId:me.organizationId,projectId:me.projectId,actorId:me.actorId,runId:record.id,deploymentAuthority:false};
  await page.route(lookup,route=>route.fulfill({status:mode==='unavailable'?503:200,contentType:'application/json',body:JSON.stringify(mode==='foreign'?{...frame,actorId:randomUUID()}:frame)}));await page.route(detailPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mode==='wrong-input'?{...record,scenario:record.scenario==='pass'?'block':'pass'}:record)}));
  try{for(const failure of ['foreign','wrong-input','unavailable']){mode=failure;await pending.getByRole('button',{name:'평가 요청 결과 다시 조회',exact:true}).click();await expect(page.getByText('평가 요청의 저장 결과를 조회하지 못했습니다.',{exact:false})).toBeVisible();await expect(page.locator('.evidence')).toHaveCount(0);await expect(pending).toBeVisible();expect(posts).toBe(1)}mode='valid';await pending.getByRole('button',{name:'평가 요청 결과 다시 조회',exact:true}).click();await expect(page.locator('.evidence').getByText('실행 '+record.id,{exact:true})).toBeVisible();await expect(pending).toHaveCount(0);expect(posts).toBe(1)}finally{await page.unroute(lookup);await page.unroute(detailPath)}
  await expect(page.getByText('fixture-private-receipt',{exact:false})).toHaveCount(0);
 }finally{await page.unroute(createPath)}
 phase('single malformed POST never forwarded; read-only synthetic lookup refuses foreign actor mismatched original input and HTTP503 before exact scoped read-only recovery; retained key never generates another submission; actual resolution API is separately verified against existing owned admission');
});
test('administrator distinguishes uncertain evaluation review receipts from verified receipt gate-read failure',async({page})=>{
 await login(page,'demo-admin');const {record}=await existingSyntheticEvaluation(page,true);await page.locator('.runs li button').filter({hasText:record.id.slice(0,8)}).click();
 await page.getByLabel('검토 사유',{exact:true}).fill('Synthetic intercepted review boundary');const button=page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}),path='**/backend/runs/'+record.id+'/reviews',gatePath='**/backend/runs/'+record.id+'/gate';let mode='abort',posts=0;
 await page.route(path,route=>{posts++;if(mode==='abort')return route.abort('failed');if(mode==='refused')return route.fulfill({status:403,body:'fixture-private-refusal'});if(mode==='malformed')return route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private":'});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:randomUUID(),decision:mode==='array'?['approved']:mode==='mismatched'?'rejected':'approved'})})});
 try{
  for(const failure of ['abort','malformed','array','mismatched']){mode=failure;await button.click();await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toBeVisible();await expect(button).toBeEnabled();await expect(page.getByText('릴리스 허용',{exact:true})).toHaveCount(0)}
  mode='refused';await button.click();await expect(page.getByText('권한 또는 요청 검증을 확인해 주세요.',{exact:true})).toBeVisible();await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toHaveCount(0);
  mode='valid';await page.route(gatePath,route=>route.fulfill({status:503,body:'fixture-private-gate'}));try{await button.click();await expect(page.getByText('검토 저장 결과는 확인했지만 현재 게이트를 확인하지 못했습니다.',{exact:false})).toBeVisible();await expect(page.getByText('릴리스 허용',{exact:true})).toHaveCount(0);await expect(button).toBeEnabled()}finally{await page.unroute(gatePath)}expect(posts).toBe(6);await expect(page.getByText('fixture-private',{exact:false})).toHaveCount(0);
 }finally{await page.unroute(path)}
 phase('all six review POSTs intercepted and never forwarded; lost/malformed/coerced/substituted receipts clear permission and remain uncertain;403 stays explicit refusal; synthetic valid receipt followed by503 remains distinct from missing receipt; no actual review or business mutation');
});
test('administrator bounds stalled evaluation cancellation and separates confirmed receipt from unavailable gate',async({page})=>{
 await login(page,'demo-admin');const {record,gate}=await existingSyntheticEvaluation(page);const pendingRecord={...record,state:'queued',decision:'inconclusive',result:{state:'queued',decision:'inconclusive',executionEngine:'python-queued',rules:[{id:'worker-completion',required:true,status:'inconclusive',reason:'Synthetic pending cancellation observation'}]}},pendingGate={...gate,decision:'inconclusive',deploymentAllowed:false};
 const read='**/backend/runs/'+record.id,gatePath=read+'/gate',cancelPath=read+'/cancel';let posts=0,mode='stalled',release!:()=>void,entered!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve),done=new Promise<void>(resolve=>finished=resolve);
 await page.route(read,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(pendingRecord)}));await page.route(gatePath,route=>route.fulfill({status:mode==='confirmed'?503:200,contentType:'application/json',body:JSON.stringify(pendingGate)}));
 await page.route(cancelPath,async route=>{posts++;if(mode==='stalled'){entered();await held;try{await route.abort('failed')}catch{/* owned timed-out request */}finally{finished()}return}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...record,state:'failed',decision:'inconclusive',result:{state:'failed',decision:'inconclusive',executionEngine:'java-cancelled',rules:[{id:'evaluation-cancelled',required:true,status:'inconclusive',reason:'Synthetic confirmed cancellation receipt'}]}})})});
 try{
  await page.locator('.runs li button').filter({hasText:record.id.slice(0,8)}).click();await page.getByLabel('평가 취소 사유',{exact:true}).fill('Synthetic intercepted cancellation');const button=page.getByRole('button',{name:'평가 취소',exact:true});await button.click();await started;await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toBeVisible({timeout:15000});await expect(button).toBeEnabled();expect(posts).toBe(1);release();await done;await expect(page.getByText('평가 취소 결과를 확인했습니다.',{exact:true})).toHaveCount(0);
  mode='confirmed';await button.click();await expect(page.getByText('평가 취소 결과는 확인했지만 현재 게이트를 확인하지 못했습니다.',{exact:false})).toBeVisible();await expect(button).toHaveCount(0);await expect(page.getByText('릴리스 허용',{exact:true})).toHaveCount(0);expect(posts).toBe(2);
 }finally{release();await page.unroute(cancelPath);await page.unroute(read);await page.unroute(gatePath)}
 phase('synthetic pending read uses exact existing scope; intercepted cancellation POST stalls to actual10-second browser bound and is never forwarded; no automatic retry or false cancellation success; explicit synthetic valid cancellation receipt followed by503 is shown separately without release permission; original business data unchanged');
});

test('viewer reads scoped evaluation review history and rejects replayed pages and delayed selection responses',async({page})=>{
 await login(page,'demo-viewer');const rows=await (await page.request.get('/backend/runs')).json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);const id=rows[0].id;
 const actual=await (await page.request.get('/backend/runs/'+id+'/reviews/page')).json();expect(actual.runId).toBe(id);expect(actual.deploymentAuthority).toBe(false);const me=await (await page.request.get('/backend/me')).json(),gate=await (await page.request.get('/backend/runs/'+id+'/gate')).json();
 await page.locator('.runs li button').filter({hasText:id.slice(0,8)}).click();const region=page.getByRole('region',{name:'평가 검토 이력',exact:true}),latest=region.getByRole('button',{name:'평가 검토 이력 조회',exact:true});await latest.click();await expect(region.getByRole('status')).toContainText(actual.entries.length?'검토 이력을 확인했습니다.':'검토 이력이 없습니다.');await expect(region.locator('li')).toHaveCount(actual.entries.length);
 const token=(sequence:number,domain='RRV')=>{const bytes=Buffer.alloc(59);bytes.write(domain);for(const [offset,value] of [[3,me.organizationId],[19,me.projectId],[35,id]] as const)Buffer.from((value as string).replaceAll('-',''),'hex').copy(bytes,offset);bytes.writeBigInt64BE(BigInt(sequence),51);return bytes.toString('base64url')};
 const synthetic={id:randomUUID(),actor_id:me.actorId,decision:'rejected',reason:'Synthetic review navigation',review_sequence:100,policy_version:gate.policyVersion,policy_digest:gate.policyDigest,created_at:'2026-10-14T04:00:00.123456+00:00'},first={...actual,entries:Array.from({length:50},(_,index)=>({...synthetic,id:'00000000-0000-4000-8000-'+(index+1).toString(16).padStart(12,'0'),review_sequence:100-index})),nextCursor:token(51)},last={...actual,entries:[{...synthetic,review_sequence:50}],nextCursor:null};let mode='valid';const path='**/backend/runs/'+id+'/reviews/page**';
 await page.route(path,route=>{const older=route.request().url().endsWith('/'+token(51));if(mode==='unavailable'&&older)return route.fulfill({status:503,body:'{}'});const frame=mode==='foreign'?{...first,runId:randomUUID()}:mode==='campaign'?{...first,nextCursor:token(51,'CRV')}:mode==='array-decision'?{...first,entries:[{...synthetic,decision:['approved']}],nextCursor:null}:mode==='invalid-date'?{...first,entries:[{...synthetic,created_at:'2026-02-30T12:00:00Z'}],nextCursor:null}:mode==='long-reason'?{...first,entries:[{...synthetic,reason:'R'.repeat(500)}],nextCursor:null}:mode==='escaped'?{...first,entries:[{...synthetic,reason:'<img src=x onerror="window.__runReviewInjected=true">'}],nextCursor:null}:older?(mode==='replayed'?first:last):first;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(frame)})});
 try{
  for(const failure of ['foreign','campaign','invalid-date','array-decision']){mode=failure;await latest.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0)}
  await page.setViewportSize({width:375,height:812});mode='long-reason';await latest.click();await expect(region.locator('li')).toHaveCount(1);await expect(region.getByText('R'.repeat(500),{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  mode='escaped';await latest.click();await expect(region.locator('li')).toHaveCount(1);await expect(region.getByText('<img src=x onerror="window.__runReviewInjected=true">',{exact:true})).toBeVisible();await expect(region.locator('img')).toHaveCount(0);expect(await page.evaluate(()=>('__runReviewInjected' in window))).toBe(false);
  mode='valid';await latest.click();await expect(region.locator('li')).toHaveCount(50);const next=region.getByRole('button',{name:'다음 검토 페이지',exact:true}),previous=region.getByRole('button',{name:'이전 검토 페이지',exact:true});await next.click();await expect(region.locator('li')).toHaveCount(1);await expect(next).toBeDisabled();await previous.click();await expect(region.locator('li')).toHaveCount(50);
  for(const failure of ['replayed','unavailable']){mode=failure;await next.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0);mode='valid';await latest.click();await expect(region.locator('li')).toHaveCount(50)}
 }finally{await page.unroute(path)}
 if(rows.length>1){let release!:()=>void,entered!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve),done=new Promise<void>(resolve=>finished=resolve);await page.route(path,async route=>{const response=await route.fetch();entered();await held;try{await route.fulfill({response})}catch{/* owned selection abort */}finally{finished()}});try{await latest.click();await started;await page.locator('.runs li button').filter({hasText:rows[1].id.slice(0,8)}).click();await expect(region.locator('li')).toHaveCount(0);release();await done;await expect(region.locator('li')).toHaveCount(0);await expect(region.getByRole('status')).toBeEmpty()}finally{release();await page.unroute(path)}}
 phase('actual evaluation history read; explicitly intercepted synthetic navigation verifies scope campaign-domain dates escaped text replay HTTP503 and next/previous; delayed old evaluation response never restores rows; no business writes');
});

test('viewer navigates bounded review pages and rejects replayed boundaries without business writes',async({page})=>{
 await login(page,'demo-viewer');const rows=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);let id=rows[0].id;
 for(const row of rows){const frame=await (await page.request.get('/backend/campaigns/'+row.id+'/reviews/page')).json();if(frame.entries.length){id=row.id;break}}
 const actual=await (await page.request.get('/backend/campaigns/'+id+'/reviews/page')).json();expect(actual.entries.length).toBeGreaterThan(0);
 const encode=(sequence:number,campaign=id)=>{const bytes=Buffer.alloc(59);bytes.write('CRV');for(const [offset,value] of [[3,actual.organizationId],[19,actual.projectId],[35,campaign]] as const)Buffer.from((value as string).replaceAll('-',''),'hex').copy(bytes,offset);bytes.writeBigInt64BE(BigInt(sequence),51);return bytes.toString('base64url')};
 const entries=Array.from({length:50},(_,index)=>({...actual.entries[0],id:'00000000-0000-4000-8000-'+(index+1).toString(16).padStart(12,'0'),review_sequence:100-index,reason:'Synthetic navigation record '+index}));
 const first={...actual,entries,nextCursor:encode(51)},last={...actual,entries:[{...actual.entries[0],id:'00000000-0000-4000-8000-000000000099',review_sequence:50,reason:'Synthetic older navigation record'}],nextCursor:null};let mode='valid';
 const routePath='**/backend/campaigns/'+id+'/reviews/page**';
 await page.route(routePath,route=>{const older=route.request().url().endsWith('/'+encode(51));if(older&&mode==='unavailable')return route.fulfill({status:503,body:'{}'});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(older?(mode==='replayed'?first:last):first)})});
 try{
  await page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();const region=page.getByRole('region',{name:'캠페인 검토 이력',exact:true}),latest=region.getByRole('button',{name:'캠페인 검토 이력 조회',exact:true}),next=region.getByRole('button',{name:'다음 검토 페이지',exact:true}),previous=region.getByRole('button',{name:'이전 검토 페이지',exact:true});
  await latest.click();await expect(region.locator('li')).toHaveCount(50);await expect(previous).toBeDisabled();await expect(next).toBeEnabled();await next.click();await expect(region.locator('li')).toHaveCount(1);await expect(region.getByText('검토 이력 페이지 2 · 1개',{exact:true})).toBeVisible();await expect(next).toBeDisabled();await previous.click();await expect(region.locator('li')).toHaveCount(50);
  for(const failure of ['replayed','unavailable']){mode=failure;await next.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0);await latest.click();await expect(region.locator('li')).toHaveCount(50)}
  mode='valid';await next.click();await expect(region.locator('li')).toHaveCount(1);await latest.click();await expect(region.getByText('검토 이력 페이지 1 · 50개',{exact:true})).toBeVisible();phase('actual scoped frame supplies metadata; explicitly intercepted synthetic 51-row navigation verifies next previous last page replay rejection HTTP503 clearing and first-page recovery; business writes absent');
 }finally{await page.unroute(routePath)}
});

test('viewer reads actual campaign review history and recovers from substituted scope and HTTP 503',async({page})=>{
 await login(page,'demo-viewer');const listResponse=await page.request.get('/backend/campaigns');phase('review-history fixture list HTTP '+listResponse.status());expect(listResponse.status()).toBe(200);const rows=await listResponse.json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);let id=rows[0].id;
 for(const row of rows){const response=await page.request.get('/backend/campaigns/'+row.id+'/reviews/page');expect(response.status()).toBe(200);if((await response.json()).entries.length){id=row.id;break}}
 const response=await page.request.get('/backend/campaigns/'+id+'/reviews/page');expect(response.status()).toBe(200);const frame=await response.json();expect(frame.campaignId).toBe(id);expect(frame.deploymentAuthority).toBe(false);expect(frame.entries.length).toBeLessThanOrEqual(50);phase('actual review history entry count '+frame.entries.length);
 await page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();const region=page.getByRole('region',{name:'캠페인 검토 이력',exact:true}),button=region.getByRole('button',{name:'캠페인 검토 이력 조회',exact:true});await button.click();await expect(region.getByRole('status')).toContainText(frame.entries.length?'검토 이력을 확인했습니다.':'검토 이력이 없습니다.');await expect(region.locator('li')).toHaveCount(frame.entries.length);
 const path='**/backend/campaigns/'+id+'/reviews/page';
 for(let index=0;index<frame.entries.length;index++){const row=region.locator('li').nth(index),entry=frame.entries[index];await expect(row).toContainText(entry.reason);await expect(row).toContainText(entry.actor_id);await expect(row).toContainText(entry.policy_version);await expect(row).toContainText(entry.policy_digest);await expect(row).toContainText(entry.created_at)}
 if(frame.entries.length){const marker='<img src=x onerror="window.__reviewInjected=true">';await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...frame,entries:[{...frame.entries[0],reason:marker}]})}));try{await button.click();await expect(region.getByText(marker,{exact:true})).toBeVisible();await expect(region.locator('img')).toHaveCount(0);expect(await page.evaluate(()=>('__reviewInjected' in window))).toBe(false)}finally{await page.unroute(path)}}
 if(frame.entries.length){await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...frame,entries:[{...frame.entries[0],created_at:'2026-02-30T12:00:00Z'}]})}));try{await button.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0);await expect(button).toBeEnabled()}finally{await page.unroute(path)}phase('impossible review date rejected without retaining previous rows')}
 if(rows.some(row=>row.id!==id)){
  const otherId=rows.find(row=>row.id!==id)!.id;let releaseSwitch!:()=>void,enteredSwitch!:()=>void,finishedSwitch!:()=>void;const heldSwitch=new Promise<void>(resolve=>releaseSwitch=resolve),startedSwitch=new Promise<void>(resolve=>enteredSwitch=resolve),doneSwitch=new Promise<void>(resolve=>finishedSwitch=resolve);
  await page.route(path,async route=>{const response=await route.fetch();enteredSwitch();await heldSwitch;try{await route.fulfill({response})}catch{/* selection aborts the owned request */}finally{finishedSwitch()}});
  try{await button.click();await startedSwitch;await page.getByRole('button',{name:'캠페인 '+otherId.slice(0,8),exact:true}).click();await expect(region.locator('li')).toHaveCount(0);releaseSwitch();await doneSwitch;await expect(region.locator('li')).toHaveCount(0);await expect(region.getByRole('status')).toBeEmpty()}finally{releaseSwitch();await page.unroute(path)}
  await page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();await button.click();await expect(region.getByRole('status')).toContainText(frame.entries.length?'검토 이력을 확인했습니다.':'검토 이력이 없습니다.');await expect(region.locator('li')).toHaveCount(frame.entries.length);phase('switching actual campaign aborts held review response; previous campaign rows never return; manual selected campaign read recovers');
 }
 let release!:()=>void,finished!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>release=resolve),done=new Promise<void>(resolve=>finished=resolve),started=new Promise<void>(resolve=>entered=resolve);
 await page.route(path,async route=>{entered();await held;try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(frame)})}catch{}finally{finished()}});
 try{await button.click();await started;await expect(region.locator('li')).toHaveCount(0);await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.',{timeout:12000});await expect(button).toBeEnabled();release();await done;await expect(region.locator('li')).toHaveCount(0);await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.')}finally{release();await done;await page.unroute(path)}
 await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...frame,organizationId:'22222222-2222-4222-8222-222222222222'})}));
 try{await button.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0)}finally{await page.unroute(path)}
 await page.route(path,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));try{await button.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(button).toBeEnabled()}finally{await page.unroute(path)}
 await button.click();await expect(region.getByRole('status')).toContainText(frame.entries.length?'검토 이력을 확인했습니다.':'검토 이력이 없습니다.');await expect(region.locator('li')).toHaveCount(frame.entries.length);
 await page.setViewportSize({width:390,height:844});await expect(region).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 phase('actual scoped review history read; substituted scope and503 clear older rows; explicit retry recovers; past reviews are not current deployment authority; no business writes');
});
test('administrator sees uncertain cancellation guidance with a synthetic pending read and intercepted POST',async({page})=>{
 await login(page,'demo-admin');const rows=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);const id=rows[0].id;
 const record=await (await page.request.get('/backend/campaigns/'+id)).json(),gate=await (await page.request.get('/backend/campaigns/'+id+'/gate')).json();
 record.state='queued';record.decision='inconclusive';record.cases[0].state='queued';record.cases[0].decision='inconclusive';record.result.state='queued';record.result.decision='inconclusive';record.result.rules[0].status='inconclusive';
 gate.decision='inconclusive';gate.deploymentAllowed=false;
 const read='**/backend/campaigns/'+id,gatePath=read+'/gate',cancelPath=read+'/cancel';let posts=0;
 await page.route(read,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(record)}));await page.route(gatePath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(gate)}));
 await page.route(cancelPath,async route=>{expect(route.request().method()).toBe('POST');posts++;await route.abort('failed')});
 try{await page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();await page.getByLabel('캠페인 취소 사유',{exact:true}).fill('synthetic intercepted cancellation');const button=page.getByRole('button',{name:'미완료 사례 취소',exact:true});await button.click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();await expect(button).toBeEnabled();expect(posts).toBe(1);await expect(page.getByText('캠페인의 미완료 사례 취소를 확인했습니다.',{exact:true})).toHaveCount(0)}
 finally{await page.unroute(cancelPath);await page.unroute(gatePath);await page.unroute(read)}
 phase('synthetic pending campaign response uses real existing version bindings; cancel POST never forwarded; uncertain guidance and no automatic retry, no real cancellation or business writes');
});
test('administrator receives uncertain receipt guidance when the intercepted write loses its response',async({page})=>{
 await login(page,'demo-admin');const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];let id:string|null=null;
 for(const row of records){const record=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(record.state!=='queued'&&(await page.request.get('/backend/campaigns/'+row.id+'/evidence')).ok()){id=row.id;break}}
 expect(id).not.toBeNull();await page.getByRole('button',{name:'캠페인 '+id!.slice(0,8),exact:true}).click();
 const button=page.getByRole('button',{name:'현재 판정의 서명 기록 저장',exact:true});await expect(button).toBeEnabled();
 let posts=0;const path='**/backend/campaigns/'+id+'/receipts';await page.route(path,async route=>{if(route.request().method()==='POST'){posts++;await route.abort('failed')}else await route.continue()});
 try{await button.click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();await expect(button).toBeEnabled();expect(posts).toBe(1);await expect(page.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toHaveCount(0)}finally{await page.unroute(path)}
 phase('receipt write intercepted and never forwarded; lost response gives fixed uncertain guidance and no automatic retry or verified receipt; no business writes');
});
test('editor sees uncertain write guidance after an intercepted POST timeout without resubmission',async({page})=>{
 await login(page,'demo-editor');
 const path='**/backend/versions/agents',button=page.getByRole('button',{name:'에이전트 버전 고정',exact:true});
 await expect(button).toBeEnabled();let release!:()=>void,finished!:()=>void,entered!:()=>void,posts=0;
 const held=new Promise<void>(resolve=>release=resolve),done=new Promise<void>(resolve=>finished=resolve),started=new Promise<void>(resolve=>entered=resolve);
 await page.route(path,async route=>{if(route.request().method()!=='POST'){await route.continue();return}posts++;entered();await held;try{await route.abort()}catch{}finally{finished()}});
 try{await button.click();await started;await expect(button).toBeDisabled();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible({timeout:12000});await expect(button).toBeEnabled();expect(posts).toBe(1);release();await done;await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();expect(posts).toBe(1)}
 finally{release();await done;await page.unroute(path)}
 await page.route(path,async route=>{if(route.request().method()==='POST'){posts++;await route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private-response":'})}else await route.continue()});
 try{await button.click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();await expect(button).toBeEnabled();expect(posts).toBe(2);await expect(page.getByText('fixture-private-response',{exact:false})).toHaveCount(0)}finally{await page.unroute(path)}
 phase('registration POST intercepted without forwarding; timeout is uncertain, controls recover and no automatic resubmission occurs; no business writes');
});
test('viewer recovers campaign selection after a stalled read and HTTP 503 without automatic retry',async({page})=>{
 await login(page,'demo-viewer');
 const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];
 expect(records.length).toBeGreaterThan(0);const id=records[0].id,path='**/backend/campaigns/'+id;
 const button=page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true});await expect(button).toBeVisible();
 let release!:()=>void,finished!:()=>void,entered!:()=>void,requests=0;
 const held=new Promise<void>(resolve=>release=resolve),done=new Promise<void>(resolve=>finished=resolve),started=new Promise<void>(resolve=>entered=resolve);
 await page.route(path,async route=>{requests++;entered();await held;try{await route.abort()}catch{}finally{finished()}});
 try{await button.click();await started;await expect(button).toBeDisabled();await expect(button).toBeEnabled({timeout:12000});expect(requests).toBe(1);await expect(page.getByRole('heading',{name:'캠페인 평가 근거',exact:true})).toHaveCount(0)}
 finally{release();await done;await page.unroute(path)}
 await page.route(path,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 try{await button.click();await expect(page.getByText('캠페인 요청을 확인하지 못했습니다.',{exact:true})).toBeVisible();await expect(button).toBeEnabled()}
 finally{await page.unroute(path)}
 await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private-read":'}));
 try{await button.click();await expect(page.getByText('캠페인 요청을 확인하지 못했습니다.',{exact:true})).toBeVisible();await expect(button).toBeEnabled();await expect(page.getByText('fixture-private-read',{exact:false})).toHaveCount(0);await expect(page.getByRole('heading',{name:'캠페인 평가 근거',exact:true})).toHaveCount(0)}finally{await page.unroute(path)}
 await button.click();await expect(page.getByRole('heading',{name:'캠페인 평가 근거',exact:true})).toBeVisible();await expect(button).toBeEnabled();
 phase('campaign read timeout and503 release controls; no automatic retry or business writes; explicit retry restores actual scoped campaign');
});
const users=JSON.parse(readFileSync(resolve(process.cwd(),'../../.local/stack/demo-credentials.json'),'utf-8')) as {username:string;password:string;organizationId:string}[];
test('viewer searches actual scoped audit actions and resources and rejects a substituted search frame',async({page})=>{
 await login(page,'demo-viewer');const reference=await (await page.request.get('/backend/audit-search/all/all')).json();expect(reference.entries).toHaveLength(25);const supported=await (await page.request.get('/backend/audit-search/version.agents.retired/all')).json();const entry=supported.entries[0];expect(entry).toBeDefined();expect(auditFilters(entry.action,entry.resourceId).action).toBe('version.agents.retired');const region=page.getByRole('region',{name:'감사 기록 검색',exact:true});
 await region.getByLabel('감사 작업 종류',{exact:true}).selectOption(entry.action);await region.getByLabel('감사 대상 ID',{exact:true}).fill(entry.resourceId);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.locator('[data-audit-search-id="'+entry.id+'"]')).toBeVisible();
 const rows=region.locator('[data-audit-search-id]');for(let index=0;index<await rows.count();index++){await expect(rows.nth(index)).toContainText(entry.action);await expect(rows.nth(index)).toContainText(entry.resourceId)}
 await region.getByLabel('감사 작업 종류',{exact:true}).selectOption('all');await expect(rows).toHaveCount(0);await region.getByLabel('감사 대상 ID',{exact:true}).fill('');await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);const first=await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')));
 const nextPath='**/backend/audit-search/all/all/'+reference.nextCursor;
 try{await page.route(nextPath,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await region.getByRole('button',{name:'다음 검색 페이지',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);await expect(region.getByRole('navigation',{name:'감사 검색 페이지',exact:true})).toHaveCount(0)}finally{await page.unroute(nextPath)}
 await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);expect(await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')))).toEqual(first);
 await region.getByRole('button',{name:'다음 검색 페이지',exact:true}).click();await expect(region.getByText('검색 페이지 2 · 25개 기록',{exact:true})).toBeVisible();const second=await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')));expect(second.some(id=>first.includes(id))).toBe(false);await region.getByRole('button',{name:'이전 검색 페이지',exact:true}).click();await expect(region.getByText('검색 페이지 1 · 25개 기록',{exact:true})).toBeVisible();expect(await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')))).toEqual(first);
 phase('failed next-page request clears older rows and page controls; manual restart restores the first page before distinct next and previous navigation');
 const path='**/backend/audit-search/all/all';try{await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...reference,filters:{action:'review.approved',resourceId:null}})}));await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0)}finally{await page.unroute(path)}
 // Hold a real old-condition response until a new search has completed. The
 // cancelled request must not restore its rows, status or pagination controls.
 let releaseOld!:()=>void,oldStarted!:()=>void,oldFinished!:()=>void;const heldOld=new Promise<void>(resolve=>{releaseOld=resolve}),startedOld=new Promise<void>(resolve=>{oldStarted=resolve}),finishedOld=new Promise<void>(resolve=>{oldFinished=resolve});
 await page.route(path,async route=>{oldStarted();await heldOld;try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(reference)})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{oldFinished()}});
 try{
  await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await startedOld;await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeDisabled();
  await region.getByLabel('감사 작업 종류',{exact:true}).selectOption(entry.action);await region.getByLabel('감사 대상 ID',{exact:true}).fill(entry.resourceId);await expect(rows).toHaveCount(0);await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeEnabled();
  await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.locator('[data-audit-search-id="'+entry.id+'"]')).toBeVisible();const fresh=await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')));
  releaseOld();await finishedOld;await expect.poll(()=>rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')))).toEqual(fresh);await expect(region.getByRole('status')).toHaveText('');
  for(let index=0;index<await rows.count();index++){await expect(rows.nth(index)).toContainText(entry.action);await expect(rows.nth(index)).toContainText(entry.resourceId)}
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 }finally{releaseOld();await page.unroute(path)}
 let invalidRequests=0;const countInvalid=()=>{invalidRequests++};const invalidPath='**/backend/audit-search/**/invalid-target';await page.route(invalidPath,async route=>{countInvalid();await route.abort()});
 try{await region.getByLabel('감사 대상 ID',{exact:true}).fill('invalid-target');await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);expect(invalidRequests).toBe(0)}finally{await page.unroute(invalidPath)}
 await region.getByLabel('감사 작업 종류',{exact:true}).selectOption('all');await region.getByLabel('감사 대상 ID',{exact:true}).fill('');
 try{await page.route(path,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeEnabled()}finally{await page.unroute(path)}
 await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);await expect(region.getByRole('status')).toHaveText('');
 // Exercise the production AbortSignal timeout without mocking browser clocks.
 let releaseTimeout!:()=>void,timeoutStarted!:()=>void,timeoutFinished!:()=>void;const heldTimeout=new Promise<void>(resolve=>{releaseTimeout=resolve}),startedTimeout=new Promise<void>(resolve=>{timeoutStarted=resolve}),finishedTimeout=new Promise<void>(resolve=>{timeoutFinished=resolve});
 await page.route(path,async route=>{timeoutStarted();await heldTimeout;try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(reference)})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{timeoutFinished()}});
 try{await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await startedTimeout;await expect(rows).toHaveCount(0);await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeDisabled();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.',{timeout:15000});await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeEnabled();releaseTimeout();await finishedTimeout;await expect(rows).toHaveCount(0);await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.')}finally{releaseTimeout();await page.unroute(path)}
 await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);await expect(region.getByRole('status')).toHaveText('');
 phase('actual ten-second browser request timeout clears rows, releases the search button, ignores the delayed response and permits a successful manual retry; clocks and timeout implementation unchanged');
 const completed=await (await page.request.get('/backend/audit-search/evaluation.completed/all')).json();expect(completed.entries.length).toBeGreaterThan(0);const runEntry=completed.entries[0];await region.getByLabel('감사 작업 종류',{exact:true}).selectOption(runEntry.action);await region.getByLabel('감사 대상 ID',{exact:true}).fill(runEntry.resourceId);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();const runRow=region.locator('[data-audit-search-id="'+runEntry.id+'"]');await expect(runRow).toBeVisible();await runRow.getByRole('button',{name:'평가 근거 '+runEntry.resourceId.slice(0,8),exact:true}).click();await expect(page.locator('.evidence').getByText('실행 '+runEntry.resourceId,{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true})).toHaveCount(0);
 phase('viewer opens the exact existing scoped evaluation from a verified audit row without gaining review authority or writing business records');
 await page.getByRole('button',{name:'근거 해시·버전 확인',exact:true}).click();await expect(page.getByText('서버와 브라우저의 바이트 해시 검증 완료',{exact:false})).toBeVisible();
 const other=completed.entries.find((value:{resourceId:string})=>value.resourceId!==runEntry.resourceId);expect(other).toBeDefined();await region.getByLabel('감사 대상 ID',{exact:true}).fill(other.resourceId);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();const otherRow=region.locator('[data-audit-search-id="'+other.id+'"]');await expect(otherRow).toBeVisible();
 const detailPath='**/backend/runs/'+other.resourceId;let releaseDetail!:()=>void,detailStarted!:()=>void;const heldDetail=new Promise<void>(resolve=>{releaseDetail=resolve}),startedDetail=new Promise<void>(resolve=>{detailStarted=resolve});await page.route(detailPath,async route=>{const response=await route.fetch();detailStarted();await heldDetail;await route.fulfill({response})});
 try{await otherRow.getByRole('button',{name:'평가 근거 '+other.resourceId.slice(0,8),exact:true}).click();await startedDetail;await expect(page.locator('.evidence')).toHaveCount(0);await expect(page.getByText('서버와 브라우저의 바이트 해시 검증 완료',{exact:false})).toHaveCount(0);releaseDetail();await expect(page.locator('.evidence').getByText('실행 '+other.resourceId,{exact:true})).toBeVisible();await expect(page.getByText('서버와 브라우저의 바이트 해시 검증 완료',{exact:false})).toHaveCount(0)}finally{releaseDetail();await page.unroute(detailPath)}
 phase('switching evaluation from audit clears previous detail gate and verified archive before a held actual detail response arrives; new detail does not inherit the previous archive proof');
 await region.getByLabel('감사 대상 ID',{exact:true}).fill(runEntry.resourceId);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();const failedDetailPath='**/backend/runs/'+runEntry.resourceId;
 try{await page.route(failedDetailPath,route=>route.fulfill({status:404,contentType:'application/json',body:'{}'}));await region.locator('[data-audit-search-id="'+runEntry.id+'"]').getByRole('button',{name:'평가 근거 '+runEntry.resourceId.slice(0,8),exact:true}).click();await expect(page.getByText('평가 근거를 확인하지 못했습니다. 다시 선택해 주세요.',{exact:true})).toBeVisible();await expect(page.locator('.evidence')).toHaveCount(0)}finally{await page.unroute(failedDetailPath)}
 await region.locator('[data-audit-search-id="'+runEntry.id+'"]').getByRole('button',{name:'평가 근거 '+runEntry.resourceId.slice(0,8),exact:true}).click();await expect(page.locator('.evidence').getByText('실행 '+runEntry.resourceId,{exact:true})).toBeVisible();
 phase('unavailable audit target leaves no previous evaluation detail or authority; selecting the same verified row again recovers through the real scoped API');
 phase('actual viewer audit search verifies distinct pages, rejects substituted frames and ignores a delayed cancelled response after a new condition finishes; mobile viewport has no document overflow; invalid UUID sends no request and an HTTP 503 clears results before a successful manual retry; no business writes');
});

test('administrator retires an owned version in the browser and cannot select it for a new campaign',async({page})=>{
 await login(page,'demo-admin');
 const csrf=(await (await page.request.get('/backend/csrf')).json()).token,key='browser-life-'+randomUUID();
 const registered=await page.request.post('/backend/versions/agents',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{key,version:1,provider:'synthetic',description:'Own browser retirement fixture'}});expect(registered.status()).toBe(200);const registration=await registered.json();const originalResponse=await page.request.get('/backend/versions/agents/'+registration.id);expect(originalResponse.status()).toBe(200);const original=await originalResponse.json();expect(original.id).toBe(registration.id);expect(original.content_sha256).toBe(registration.content_sha256);
 const datasetResponse=await page.request.post('/backend/versions/datasets',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{key:'browser-life-data-'+randomUUID(),version:1,cases:[{id:'required',scenario:'pass',required:true}]}});expect(datasetResponse.status()).toBe(200);const dataset=await datasetResponse.json();
 const admitted=await page.request.post('/backend/campaigns',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320','Idempotency-Key':randomUUID()},data:{agentVersionId:original.id,datasetVersionId:dataset.id,requiresApproval:true}});expect(admitted.status()).toBe(200);const campaignId=(await admitted.json()).id;
 await expect.poll(async()=>(await (await page.request.get('/backend/campaigns/'+campaignId)).json()).state,{timeout:35000}).toBe('succeeded');expect((await page.request.post('/backend/campaigns/'+campaignId+'/reviews',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{decision:'approved',reason:'Own browser pre-retirement approval'}})).status()).toBe(200);
 await expect.poll(async()=>(await page.request.get('/backend/campaigns/'+campaignId+'/evidence')).status(),{timeout:15000}).toBe(200);
 await page.reload();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();const workspace=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});await workspace.getByRole('button',{name:'캠페인 '+campaignId.slice(0,8),exact:true}).click();await expect(workspace.getByText('캠페인 릴리스 허용',{exact:true})).toBeVisible();const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText('서명 확인 완료 · 합성 릴리스 허용',{exact:true})).toBeVisible();
 const region=page.getByRole('region',{name:'프로젝트 에이전트 버전 이력',exact:true});await region.getByRole('button',{name:'에이전트 버전 이력 조회',exact:true}).click();
 const row=region.locator('[data-version-history-id="'+original.id+'"]');await expect(row).toBeVisible();await row.getByRole('button',{name:'버전 상태 확인',exact:true}).click();await expect(row.getByText('상태: 활성',{exact:true})).toBeVisible();
 const gateRoute='**/backend/campaigns/'+campaignId+'/gate';let releaseGate!:()=>void;const heldGate=new Promise<void>(resolve=>{releaseGate=resolve});await page.route(gateRoute,async route=>{await heldGate;await route.continue()});
 try{await row.getByLabel('버전 폐기 사유',{exact:true}).fill('Own browser immutable retirement');await row.getByRole('button',{name:'이 버전 폐기',exact:true}).click();await expect(row.getByText('상태: 폐기',{exact:true})).toBeVisible();await expect(workspace.getByText('캠페인 릴리스 허용',{exact:true})).toHaveCount(0);await expect(page.getByText('서명 확인 완료 · 합성 릴리스 허용',{exact:true})).toHaveCount(0);releaseGate();await expect(workspace.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();}finally{releaseGate();await page.unroute(gateRoute)}
 await expect(row.getByText('폐기 사유: Own browser immutable retirement',{exact:true})).toBeVisible();await expect(row.getByRole('button',{name:'이 버전 폐기',exact:true})).toHaveCount(0);
 const selection=page.getByLabel('캠페인 에이전트 버전',{exact:true}),before=await selection.inputValue();let campaignPosts=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/backend/campaigns'&&request.method()==='POST')campaignPosts++});
 await row.getByRole('button',{name:'에이전트 버전 '+key+' / v1 선택',exact:true}).click();await expect(region.getByText('폐기된 버전입니다. 새 평가 실행에 선택할 수 없습니다.',{exact:true})).toBeVisible();await expect(selection).toHaveValue(before);expect(campaignPosts).toBe(0);
 expect(await (await page.request.get('/backend/versions/agents/'+original.id)).json()).toEqual(original);phase('actual Java retirement through administrator UI immediately clears old allowed gate and current signature while the fresh gate is delayed; immutable bytes survive and retired selection is refused without another campaign submission');
});

test('viewer reads an actual retired version without a retirement control',async({page})=>{
 await login(page,'demo-admin');const csrf=(await (await page.request.get('/backend/csrf')).json()).token;const created=await page.request.post('/backend/versions/agents',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{key:'browser-viewer-life-'+randomUUID(),version:1,provider:'synthetic',description:'Own independent viewer retirement fixture'}});expect(created.status()).toBe(200);const version=await created.json(),reason='Own independent viewer retirement';const retirement=await page.request.post('/backend/versions/agents/'+version.id+'/lifecycle/retirement',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{reason}});expect(retirement.status()).toBe(200);expect((await retirement.json()).state).toBe('retired');await logout(page);phase('independent owned retired fixture prepared by an administrator before a separate viewer login');
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 에이전트 버전 이력',exact:true});await region.getByRole('button',{name:'에이전트 버전 이력 조회',exact:true}).click();await expect(region.locator('[data-version-history-id]').first()).toBeVisible();
 const row=region.locator('[data-version-history-id="'+version.id+'"]');await expect(row).toBeVisible();await row.getByRole('button',{name:'버전 상태 확인',exact:true}).click();await expect(row.getByText('상태: 폐기',{exact:true})).toBeVisible();await expect(row.getByText('폐기 사유: '+reason,{exact:true})).toBeVisible();await expect(row.getByRole('button',{name:'이 버전 폐기',exact:true})).toHaveCount(0);await expect(row.getByLabel('버전 폐기 사유',{exact:true})).toHaveCount(0);
 phase('actual viewer Keycloak session reads scoped immutable retirement and has no retirement form');
});

test('viewer downloads bounded scoped audit JSON and refuses changed bytes before download',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 감사 기록',exact:true});const identity=await (await page.request.get('/backend/me')).json();const frame=await (await page.request.get('/backend/audit-export')).json();
 const event=page.waitForEvent('download');await region.getByRole('button',{name:'감사 기록 JSON 다운로드',exact:true}).click();const download=await event;expect(await download.failure()).toBeNull();const stream=await download.createReadStream();expect(stream).not.toBeNull();let bytes=Buffer.alloc(0);for await(const chunk of stream!){bytes=Buffer.concat([bytes,chunk]);expect(bytes.length).toBeLessThanOrEqual(262144)}
 expect(bytes.toString('utf8')).toBe(frame.contentJson);expect(createHash('sha256').update(bytes).digest('hex')).toBe(frame.contentSha256);const doc=JSON.parse(bytes.toString('utf8'));expect(doc.organizationId).toBe(identity.organizationId);expect(doc.projectId).toBe(identity.projectId);expect(doc.signed).toBe(false);expect(doc.currentDeploymentAuthority).toBe(false);expect(doc.entries.length).toBeLessThanOrEqual(500);expect(doc.entireProjectHistory).toBe(!doc.hasOlderRecords);await expect(region.getByRole('status',{name:'감사 기록 조회와 내보내기 상태',exact:true})).toContainText('개 감사 기록을 검증해 내려받았습니다.');phase('actual scoped Java audit JSON bytes hash boundaries and history marker verified before browser download');
 let unexpected=false;const note=()=>{unexpected=true};page.on('download',note);try{await page.route('**/backend/audit-export',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...frame,contentJson:frame.contentJson+' '})}));await region.getByRole('button',{name:'감사 기록 JSON 다운로드',exact:true}).click();await expect(region.getByRole('status',{name:'감사 기록 조회와 내보내기 상태',exact:true})).toContainText('감사 내보내기를 검증하지 못했습니다.');expect(unexpected).toBe(false);phase('changed export bytes refused before emitting a second download')}finally{page.off('download',note);await page.unroute('**/backend/audit-export')}
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
function phase(description:string){test.info().annotations.push({type:'phase',description})}
async function login(page:Page,name:string,beforeNavigation?:()=>Promise<unknown>){
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(process.env.STACK_E2E_READ_ONLY==='true'&&url.origin==='http://127.0.0.1:4320'&&url.pathname.startsWith('/backend/')&&route.request().method()!=='GET'&&!['/backend/login','/backend/logout'].includes(url.pathname)){phase('read-only network guard refused unintended business mutation');return route.abort('blockedbyclient')}if(['http://127.0.0.1:4320','http://127.0.0.1:4322'].includes(url.origin))return route.continue();return route.abort()});
 if(beforeNavigation)await beforeNavigation();
 await page.goto('/');const info=await (await page.request.get('/backend/auth-info')).json();
 const user=users.find(u=>u.username===name)!;
 // Reporter never records invocation arguments, browser traces, cookies or credentials.
 if(info.identityProvider==='keycloak'){await page.getByRole('button',{name:'Keycloak으로 로그인',exact:true}).click();await expect(page.locator('#username')).toBeVisible();await page.evaluate(value=>{document.querySelector<HTMLInputElement>('#username')!.value=value.username;document.querySelector<HTMLInputElement>('#password')!.value=value.password;document.querySelector<HTMLFormElement>('#kc-form-login')!.requestSubmit(document.querySelector<HTMLButtonElement>('#kc-login')!)},{username:user.username,password:user.password});phase('Keycloak authorization code login')}
 else {await expect(page.getByRole('button',{name:'로그인',exact:true})).toBeEnabled();await page.evaluate(value=>{const account=document.querySelector<HTMLInputElement>('input[name="username"]')!,password=document.querySelector<HTMLInputElement>('input[name="password"]')!;account.value=value.username;password.value=value.password;account.form!.requestSubmit()}, {username:user.username,password:user.password})}
 await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();await expect(page.getByText('조직 '+user.organizationId.slice(0,8),{exact:true})).toBeVisible();
}
test.beforeEach(async({page},info)=>{
 page.on('response',response=>{if(response.status()===429&&new URL(response.url()).origin==='http://127.0.0.1:4320'&&new URL(response.url()).pathname.startsWith('/backend/'))phase('actual gateway HTTP 429 observed; no quota bypass or automatic business write retry')});
 if(process.env.STACK_E2E_QUOTA_GUARD==='true'){
  const started=Date.now();info.setTimeout(125000);
  const budget=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',[resolve(process.cwd(),'../../scripts/stack-browser-quota-guard.py')],{encoding:'utf-8',timeout:75000,maxBuffer:16384}));
  expect(budget.completed).toBe(true);expect(budget.quotaLimitsChanged).toBe(false);expect(budget.redisEntriesDeleted).toBe(false);info.setTimeout(45000+Date.now()-started);
  phase('read-only Redis test headroom verified; quotas expire naturally without changing limits or deleting counters');if(budget.waitedForNaturalExpiry)phase('actual project quota expired naturally before this browser test');
 }
});

async function logout(page:Page){const csrf=await page.request.get('/backend/csrf');const token=(await csrf.json()).token;const logout=await page.request.post('/backend/logout',{headers:{'X-CSRF-TOKEN':token,Origin:'http://127.0.0.1:4320'},data:{}});expect(logout.status()).toBe(200);expect((await page.request.get('/backend/me')).status()).toBe(401);const value=await logout.json();if(value.logoutUrl){expect(value.logoutUrl).toBe('http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A4320%2F');await page.goto(value.logoutUrl);if(new URL(page.url()).port==='4322'){await page.locator('#kc-logout').click();await page.waitForURL('http://127.0.0.1:4320/')}phase('own identity provider session logged out')}phase('own session logged out')}
test.afterEach(async({page})=>{await logout(page)});

test('viewer navigates real older evaluation pages and opens scoped evidence',async({page})=>{
 await login(page,'demo-viewer');
 const region=page.getByRole('region',{name:'프로젝트 평가 이력',exact:true});
 await region.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();
 await expect(region.locator('[data-run-history-id]')).toHaveCount(25);
 const first=await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')));
 expect(first.length).toBe(25);
 await region.getByRole('button',{name:'다음 평가 페이지',exact:true}).click();
 await expect(region.getByText(/이력 페이지 2/)).toBeVisible();
 const older=await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')));
 expect(older.length).toBeGreaterThan(0);expect(older.some(id=>first.includes(id))).toBe(false);
 await region.getByRole('button',{name:'평가 근거 '+older[0]!.slice(0,8),exact:true}).click();
 await expect(page.locator('.evidence').getByText('실행 '+older[0],{exact:true})).toBeVisible();
 await region.getByRole('button',{name:'이전 평가 페이지',exact:true}).click();
 await expect(region.getByText(/이력 페이지 1/)).toBeVisible();
 expect(await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')))).toEqual(first);
  const snapshot=await (await page.request.get('/backend/run-history')).json();
  await page.route('**/backend/run-history',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,projectId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}));
  await region.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();
  await expect(region.getByText('평가 이력을 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();
  await expect(region.locator('[data-run-history-id]')).toHaveCount(0);
 phase('actual read-only browser history returns distinct pages and opens the selected existing evaluation');
});

test('viewer reads immutable baseline conditions and verifies actual v2 current signature',async({page})=>{
 await login(page,'demo-viewer');
 const root=resolve(process.cwd(),'../../.local');
 const sources=readdirSync(root).filter(name=>/^stack-baseline-gate-[a-f0-9-]{36}\.json$/.test(name)).map(name=>({path:resolve(root,name),time:statSync(resolve(root,name)).mtimeMs})).sort((a,b)=>b.time-a.time);
 const reference=sources.map(item=>JSON.parse(readFileSync(item.path,'utf8'))).find(value=>value.completed&&value.candidateCampaignId&&value.baselineCampaignId);expect(reference).toBeTruthy();
 const id=reference.candidateCampaignId as string,baseline=reference.baselineCampaignId as string;
 const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 await region.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();
 const conditions=page.getByRole('region',{name:'고정된 릴리스 조건',exact:true});
 await conditions.getByRole('button',{name:'비교 기준·근거 유효 기간 확인',exact:true}).click();
 await expect(conditions.getByText('고정 기준 캠페인 '+baseline,{exact:true})).toBeVisible();
 await expect(conditions.getByText(/양쪽 근거 유효 기간 60초/)).toBeVisible();
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();
 await expect(checks.getByText('서명 확인 완료 · 릴리스 허용 안 됨',{exact:true})).toBeVisible();
 await expect(checks.getByText('서명에 묶인 비교 기준 '+baseline+' · 유효 기간 60초',{exact:true})).toBeVisible();
 const snapshot=await (await page.request.get('/backend/campaigns/'+id+'/release-requirements')).json();
 await page.route('**/backend/campaigns/'+id+'/release-requirements',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,projectId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}));
 await conditions.getByRole('button',{name:'비교 기준·근거 유효 기간 확인',exact:true}).click();
 await expect(conditions.getByRole('status')).toHaveText('고정된 릴리스 조건을 확인하지 못했습니다. 다시 확인해 주세요.');
 await expect(conditions.getByText('고정 기준 캠페인 '+baseline,{exact:true})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 phase('actual immutable baseline and natural expiry are visible; Java v2 signature verified and foreign condition response cleared');
});

test('administrator creates an immutable baseline campaign and approves the actual signed gate',async({page})=>{
 await login(page,'demo-admin');
 const root=resolve(process.cwd(),'../../.local'),files=readdirSync(root).filter(name=>/^stack-baseline-gate-[a-f0-9-]{36}\.json$/.test(name)).sort((a,b)=>statSync(resolve(root,b)).mtimeMs-statSync(resolve(root,a)).mtimeMs);
 const reference=files.map(name=>JSON.parse(readFileSync(resolve(root,name),'utf8'))).find(value=>value.completed&&value.baselineCampaignId);expect(reference).toBeTruthy();
 const baseline=await (await page.request.get('/backend/campaigns/'+reference.baselineCampaignId)).json();expect(baseline.agentVersion.definition.provider).toBe('synthetic');
 const csrf=(await (await page.request.get('/backend/csrf')).json()).token;const fresh=await page.request.post('/backend/campaigns',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320','Idempotency-Key':randomUUID()},data:{agentVersionId:baseline.agent_version_id,datasetVersionId:baseline.dataset_version_id,requiresApproval:true}});expect(fresh.status()).toBe(200);reference.baselineCampaignId=(await fresh.json()).id;
 await expect.poll(async()=>(await (await page.request.get('/backend/campaigns/'+reference.baselineCampaignId)).json()).state,{timeout:35000}).toBe('succeeded');await page.reload();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
 const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 await region.getByLabel('캠페인 에이전트 버전',{exact:true}).selectOption(baseline.agent_version_id);
 await region.getByLabel('캠페인 데이터셋 버전',{exact:true}).selectOption(baseline.dataset_version_id);
 await region.getByLabel('릴리스에 고정할 비교 기준',{exact:true}).selectOption(reference.baselineCampaignId);
 await region.getByLabel('양쪽 근거 유효 기간',{exact:true}).fill('3600');
 const admitted=page.waitForResponse(response=>response.url().endsWith('/backend/campaigns')&&response.request().method()==='POST'&&response.status()===200);
 await region.getByRole('button',{name:'캠페인 실행',exact:true}).click();const candidate=await (await admitted).json();
 await expect(region.getByText('캠페인 '+candidate.id,{exact:true})).toBeVisible();
 await expect(region.getByRole('button',{name:'캠페인 검토 저장',exact:true})).toBeVisible();
 await region.getByLabel('캠페인 검토 사유',{exact:true}).fill('Own browser synthetic baseline approval');
 await region.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();
 await expect(region.getByText('캠페인 릴리스 허용',{exact:true})).toBeVisible();
 const conditions=page.getByRole('region',{name:'고정된 릴리스 조건',exact:true});
 await conditions.getByRole('button',{name:'비교 기준·근거 유효 기간 확인',exact:true}).click();
 await expect(conditions.getByText('고정 기준 캠페인 '+reference.baselineCampaignId,{exact:true})).toBeVisible();
 await expect(conditions.getByText(/양쪽 근거 유효 기간 3600초/)).toBeVisible();
 await expect.poll(async()=>{const value=await page.request.get('/backend/campaigns/'+candidate.id+'/evidence');return value.status()},{timeout:15000}).toBe(200);
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();
 await expect(checks.getByText('서명 확인 완료 · 합성 릴리스 허용',{exact:true})).toBeVisible();
 await expect(checks.getByText('서명에 묶인 비교 기준 '+reference.baselineCampaignId+' · 유효 기간 3600초',{exact:true})).toBeVisible();
 await region.getByLabel('서명 기록 메모',{exact:true}).fill('Own complete baseline archive observation');await region.getByRole('button',{name:'현재 판정의 서명 기록 저장',exact:true}).click();await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toBeVisible();
 const event=page.waitForEvent('download');await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();const download=await event;expect(await download.failure()).toBeNull();const stream=await download.createReadStream();let bytes=Buffer.alloc(0);for await(const chunk of stream!){bytes=Buffer.concat([bytes,chunk]);expect(bytes.length).toBeLessThanOrEqual(524288)}const bundle=JSON.parse(bytes.toString('utf8'));expect(bundle.schemaVersion).toBe(2);expect(bundle.baseline.campaign.id).toBe(reference.baselineCampaignId);
 const signedPayload=JSON.parse(Buffer.from(bundle.receipt.payloadBase64,'base64').toString('utf8'));expect(signedPayload.schemaVersion).toBe(4);
 expect(signedPayload.versionLifecycle.contract).toBe('campaign-version-lifecycle-v1');expect(signedPayload.versionLifecycle.campaignId).toBe(candidate.id);
 expect(signedPayload.versionLifecycle.versions.map((version:{kind:string,state:string})=>[version.kind,version.state])).toEqual([['agents','active'],['datasets','active'],['agents','active'],['datasets','active']]);
 await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('기준 캠페인의 부모와 1개 자식 보관본도 검증했습니다.');phase('actual Java v4 historical signature binds lifecycle and both complete archive chains; browser downloads the verified comparison baseline');
 let unexpected=false;const note=()=>{unexpected=true};page.on('download',note);try{const changed=structuredClone(bundle);changed.baseline.children[0].archive.contentBase64=Buffer.from('changed comparison bytes').toString('base64');const receiptId=bundle.receipt.receiptId;await page.route('**/backend/campaigns/'+candidate.id+'/receipts/'+receiptId+'/bundle',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(changed)}));await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('서명과 모든 보관 바이트의 연결을 검증하지 못해 번들을 내보내지 않았습니다.');expect(unexpected).toBe(false)}finally{page.off('download',note)}phase('altered baseline child is refused before a second browser download');
 phase('actual UI admission freezes baseline and age; Python completion and administrator review lead to verified Java v2 current signature');
});

test('viewer reads real provider reservations and clears an invented billed usage response',async({page})=>{
 await login(page,'demo-viewer');
 const region=page.getByRole('region',{name:'프로젝트 모델 실행 한도',exact:true});
 const snapshot=await (await page.request.get('/backend/provider-usage')).json();
 await region.getByRole('button',{name:'현재 실행 한도 조회',exact:true}).click();
 await expect(region.getByText(/UTC 기준일/)).toBeVisible();
 await expect(region.getByText(new RegExp('남은 예약 '+snapshot.remainingAttempts+'회'))).toBeVisible();
 await expect(region.getByRole('table',{name:'공급자별 예약과 평가 상태'})).toBeVisible();
 await page.route('**/backend/provider-usage',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,billableUsageMeasured:true})}));
 await region.getByRole('button',{name:'현재 실행 한도 조회',exact:true}).click();
 await expect(region.getByText('실행 한도를 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();
 await expect(region.getByRole('table')).toHaveCount(0);
 phase('browser displays actual scoped reservations and refuses invented paid usage');
});

test('viewer verifies a fresh signed gate and clears replayed unavailable and expired checks',async({page})=>{
 await login(page,'demo-viewer');
 await page.clock.install({time:new Date()});
 const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];
 let selected:string|null=null;
 for(const row of records){const record=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(record.state==='succeeded'&&(await page.request.get('/backend/campaigns/'+row.id+'/evidence')).ok()){selected=row.id;break}}
 expect(selected).not.toBeNull();
 await region.getByRole('button',{name:'캠페인 '+selected!.slice(0,8),exact:true}).click();
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});
 const received=page.waitForResponse(response=>response.url().includes('/gate-check/')&&response.status()===200);
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();
 const frame=await (await received).json();
 await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();phase('viewer independently verifies actual Java current-check signature in browser');
 await page.route('**/backend/campaigns/'+selected+'/gate-check/*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(frame)}));
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();
 await expect(checks.getByRole('status')).toContainText('서명·범위·유효 시간을 확인하지 못했습니다.');await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0);phase('replayed signed response for a different challenge is refused');
 await page.unroute('**/backend/campaigns/'+selected+'/gate-check/*');
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();
 await page.route('**/backend/campaigns/'+selected+'/gate-check/*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"code":"TEST_CHECK_UNAVAILABLE"}'}));
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0);await expect(checks.getByRole('status')).toContainText('서명·범위·유효 시간을 확인하지 못했습니다.');phase('request failure clears earlier signed status');
 await page.unroute('**/backend/campaigns/'+selected+'/gate-check/*');
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();
 await page.clock.setSystemTime(new Date(Date.now()-60000));await page.clock.runFor(31000);
 await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0);await expect(checks.getByRole('status')).toContainText('확인 시간이 만료됐습니다.');phase('signed result expires even when browser wall clock moves backward; no evaluation or approval is created');
});

test('a delayed signed check cannot populate another selected campaign',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];
 const candidates:string[]=[];
 for(const row of records){const record=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(record.state==='succeeded'&&(await page.request.get('/backend/campaigns/'+row.id+'/evidence')).ok())candidates.push(row.id);if(candidates.length===2)break}
 expect(candidates.length).toBe(2);const [first,second]=candidates;
 await region.getByRole('button',{name:'캠페인 '+first.slice(0,8),exact:true}).click();
 let release!:()=>void,received!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{received=resolve});
 await page.route('**/backend/campaigns/'+first+'/gate-check/*',async route=>{const response=await route.fetch();received();await held;try{await route.fulfill({response})}catch{/* The old component aborted its request. */}});
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await ready;
 await region.getByRole('button',{name:'캠페인 '+second.slice(0,8),exact:true}).click();
 release();await expect(region.getByText('캠페인 '+second,{exact:true})).toBeVisible();await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0);
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();phase('old selection response is aborted; only newly selected campaign can display its independently verified check');
});

test('viewer navigates scoped audit history without duplicate rows and clears unavailable pages',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 감사 기록',exact:true});await region.getByRole('button',{name:'최신 감사 기록 조회',exact:true}).click();await expect(region.getByText('페이지 1 · 25개 기록',{exact:true})).toBeVisible();
 const first=await region.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-audit-id')));expect(new Set(first).size).toBe(25);await region.getByRole('button',{name:'다음 감사 페이지',exact:true}).click();await expect(region.getByText(/페이지 2 · \d+개 기록/)).toBeVisible();const second=await region.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-audit-id')));expect(second.some(id=>first.includes(id))).toBe(false);phase('actual scoped PostgreSQL audit history navigates without duplicated records');
 await region.getByRole('button',{name:'이전 감사 페이지',exact:true}).click();await expect(region.getByText('페이지 1 · 25개 기록',{exact:true})).toBeVisible();expect(await region.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-audit-id')))).toEqual(first);
 await page.route('**/backend/audit',route=>route.fulfill({status:503,contentType:'application/json',body:'{"code":"TEST_AUDIT_UNAVAILABLE"}'}));await region.getByRole('button',{name:'최신 감사 기록 조회',exact:true}).click();await expect(region.getByText('감사 기록을 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();await expect(region.locator('tbody tr')).toHaveCount(0);phase('read failure clears previous audit contents instead of displaying stale history');
 await page.unroute('**/backend/audit');await region.getByRole('button',{name:'최신 감사 기록 조회',exact:true}).click();await expect(region.getByText('페이지 1 · 25개 기록',{exact:true})).toBeVisible();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);phase('audit rows recover after unavailable reads and fit mobile width');
});

test('administrator creates evaluation, approves, rejects and cannot override required failure',async({page})=>{
 await login(page,'demo-admin');phase('authenticated');await page.getByRole('button',{name:'평가 실행',exact:true}).click();phase('evaluation submitted');
 await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toBeVisible({timeout:20000});phase('worker completed');await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();
 await page.getByLabel('검토 사유',{exact:true}).fill('Synthetic browser approval');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('합성 릴리스 허용',{exact:true})).toBeVisible();phase('approval allows');
 const runId=(await page.locator('.evidence > p.mono').textContent())!.match(/[a-f0-9-]{36}/)![0],csrf=(await (await page.request.get('/backend/csrf')).json()).token;
 const rejected=await page.request.post('/backend/runs/'+runId+'/reviews',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{decision:'rejected',reason:'Synthetic independently submitted rejection'}});expect(rejected.status()).toBe(200);
 await expect(page.getByText('합성 릴리스 허용',{exact:true})).toBeVisible();
 await page.locator('.evidence .gate').getByRole('button',{name:'현재 게이트 다시 확인',exact:true}).click();await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('manual refresh replaces stale allowed snapshot with actual latest rejection');
 await page.getByLabel('검토 사유',{exact:true}).fill('Fresh synthetic approval after external rejection');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('합성 릴리스 허용',{exact:true})).toBeVisible();

 await page.getByLabel('결정',{exact:true}).selectOption('rejected');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('rejection denies');
 await page.getByLabel('합성 시나리오',{exact:true}).selectOption('block');await page.getByRole('button',{name:'평가 실행',exact:true}).click();await expect(page.locator('.evidence .badge.block')).toBeVisible({timeout:20000});await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();
});

test('viewer can read own evidence and cannot create evaluations',async({page})=>{
 await login(page,'demo-viewer');await expect(page.getByRole('button',{name:'평가 실행',exact:true})).toBeDisabled();await page.locator('.runs li button').first().click();await expect(page.getByRole('heading',{name:'평가 근거',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);
});

test('administrator fixes versions, runs a campaign and reviews the aggregate gate',async({page})=>{
 await login(page,'demo-admin');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true}),suffix=Date.now().toString(36);
 await region.getByLabel('에이전트 이름',{exact:true}).fill('browser-agent-'+suffix);await region.getByRole('button',{name:'에이전트 버전 고정',exact:true}).click();phase('agent registration submitted');await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('고정 버전 확인: browser-agent-'+suffix);
 phase('agent version confirmed');await region.getByLabel('데이터셋 이름',{exact:true}).fill('browser-data-'+suffix);await region.getByRole('button',{name:'사례 추가',exact:true}).click();phase('second case added');await region.getByLabel('사례 시나리오 2',{exact:true}).selectOption('block');await region.getByLabel('사례 2 필수',{exact:true}).uncheck();await region.getByRole('button',{name:'데이터셋 버전 고정',exact:true}).click();phase('dataset registration submitted');await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('고정 버전 확인: browser-data-'+suffix);
 const agents=await (await page.request.get('/backend/versions/agents')).json() as {id:string;resource_key:string}[],datasets=await (await page.request.get('/backend/versions/datasets')).json() as {id:string;resource_key:string}[];
 await region.getByLabel('캠페인 에이전트 버전',{exact:true}).selectOption(agents.find(v=>v.resource_key==='browser-agent-'+suffix)!.id);await region.getByLabel('캠페인 데이터셋 버전',{exact:true}).selectOption(datasets.find(v=>v.resource_key==='browser-data-'+suffix)!.id);
 await region.getByRole('button',{name:'캠페인 실행',exact:true}).click();await expect(region.getByRole('heading',{name:'캠페인 관리자 검토',exact:true})).toBeVisible({timeout:20000});await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();const first=(await region.locator('.mono').first().textContent())!.replace('캠페인 ','');await expect(region.getByText(/실행 프로필 SHA-256 [a-f0-9]{64}/)).toBeVisible();phase('actual installed evaluator profile bound to agent version');phase('version bound case evidence completed');let archiveHash='';await expect.poll(async()=>{const response=await page.request.get('/backend/campaigns/'+first+'/evidence');if(response.status()===200){archiveHash=(await response.json()).contentSha256;return true}expect(response.status()).toBe(409);return false},{timeout:30000}).toBe(true);await region.getByRole('button',{name:'캠페인 보관 근거 확인',exact:true}).click();await expect(region.getByText('캠페인과 2개 사례의 브라우저 바이트 해시 검증 완료',{exact:true})).toBeVisible();phase('browser verifies frozen parent and both child archive bytes');
 await region.getByLabel('캠페인 검토 사유',{exact:true}).fill('Version-bound browser approval');await region.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(region.getByText('캠페인 릴리스 허용',{exact:true})).toBeVisible();await region.getByLabel('서명 기록 메모',{exact:true}).fill('Historical browser approval');await region.getByRole('button',{name:'현재 판정의 서명 기록 저장',exact:true}).click();await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toBeVisible();const historical=(await (await page.request.get('/backend/campaigns/'+first+'/receipts')).json())[0].id;phase('browser verifies actual Ed25519 historical approval');await region.getByLabel('캠페인 검토 결정',{exact:true}).selectOption('rejected');await region.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('parent approval and latest rejection verified');await region.getByRole('button',{name:'서명 기록 '+historical.slice(0,8)+' 검증',exact:true}).click();await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toBeVisible();await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();await expect(region.getByText(/당시 판정 통과 · 당시 허용 예/)).toBeVisible();phase('old passing signature does not override current rejection');const downloadEvent=page.waitForEvent('download');await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();const download=await downloadEvent;expect(await download.failure()).toBeNull();const stream=await download.createReadStream();expect(stream).not.toBeNull();let bytes=Buffer.alloc(0);for await(const chunk of stream!){bytes=Buffer.concat([bytes,chunk]);expect(bytes.length).toBeLessThanOrEqual(524288)}const bundle=JSON.parse(bytes.toString('utf8'));expect(bundle.kind).toBe('campaign-observation-bundle');expect(bundle.currentDeploymentAuthority).toBe(false);expect(bundle.receipt.receiptId).toBe(historical);expect(bundle.children.length).toBe(2);await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('browser exports verified signed parent and all child bytes while current rejection remains denied');let unexpectedDownload=false;const noteDownload=()=>{unexpectedDownload=true};page.on('download',noteDownload);try{const altered=structuredClone(bundle);altered.children[0].archive.contentBase64=Buffer.from('altered archive bytes').toString('base64');await page.route('**/backend/campaigns/'+first+'/receipts/'+historical+'/bundle',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(altered)}));await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('서명과 모든 보관 바이트의 연결을 검증하지 못해 번들을 내보내지 않았습니다.');expect(unexpectedDownload).toBe(false);phase('browser refuses altered child archive before creating a download')}finally{page.off('download',noteDownload)}expect((await (await page.request.get('/backend/campaigns/'+first+'/evidence')).json()).contentSha256).toBe(archiveHash);
 await region.getByRole('button',{name:'캠페인 실행',exact:true}).click();await expect(region.getByRole('heading',{name:'캠페인 관리자 검토',exact:true})).toBeVisible({timeout:20000});await region.getByLabel('비교 기준 캠페인',{exact:true}).selectOption(first);await region.getByRole('button',{name:'캠페인 회귀 비교',exact:true}).click();await expect(region.getByText('비교 결과 no-regression',{exact:true})).toBeVisible();phase('same dataset comparison remains advisory');await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toHaveCount(0);phase('new selection clears historical proof');
});

test('campaign response with substituted immutable content cannot display evidence or permission',async({page})=>{
 await login(page,'demo-admin');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true}),rows=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);const id=rows[0].id,evidence=await (await page.request.get('/backend/campaigns/'+id)).json();
 await page.route('**/backend/campaigns/'+id,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...evidence,agentVersion:{...evidence.agentVersion,definition:{...evidence.agentVersion.definition,description:'substituted content'}}})}));await region.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('버전과 평가 근거의 연결을 확인하지 못했습니다.');await expect(region.getByRole('heading',{name:'캠페인 평가 근거',exact:true})).toHaveCount(0);await expect(region.getByText('캠페인 릴리스 허용',{exact:true})).toHaveCount(0);phase('actual canonical version hash rejects substituted campaign content');
});

test('a delayed earlier selection cannot replace the newer selected evidence',async({page})=>{
 await login(page,'demo-admin');const rows=await (await page.request.get('/backend/runs')).json() as {id:string}[];expect(rows.length).toBeGreaterThanOrEqual(2);const first=rows[0].id,second=rows[1].id;const evidence=await (await page.request.get('/backend/runs/'+first)).json();let release:()=>void=()=>{};let arrived:()=>void=()=>{};const intercepted=new Promise<void>(resolve=>{arrived=resolve});const held=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/backend/runs/'+first,async route=>{arrived();await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(evidence)})});
 try{await page.locator('.runs button').filter({hasText:first.slice(0,8)}).click();await intercepted;await page.locator('.runs button').filter({hasText:second.slice(0,8)}).click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+second);const response=page.waitForResponse(r=>r.url().endsWith('/backend/runs/'+first));release();await response;await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+second)}finally{release()}
});


test('browser verifies exact archived bytes and clears proof when selecting another run',async({page})=>{
 await login(page,'demo-admin');expect((await (await page.request.get('/backend/auth-info')).json()).objectStorage).toBe('minio');
 await page.getByRole('button',{name:'평가 실행',exact:true}).click();await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toBeVisible({timeout:20000});
 const selected=await page.locator('.evidence > .mono').textContent();const id=selected!.replace('실행 ','');let proof:{contentSha256:string;storageVersion:string}|undefined;
 await expect.poll(async()=>{const response=await page.request.get('/backend/runs/'+id+'/evidence');if(response.status()===200){proof=await response.json();return true}expect(response.status()).toBe(409);return false},{timeout:30000}).toBe(true);
 await page.getByRole('button',{name:'근거 해시·버전 확인',exact:true}).click();await expect(page.getByText('SHA-256 '+proof!.contentSha256,{exact:true})).toBeVisible();await expect(page.getByText('저장 버전 '+proof!.storageVersion,{exact:true})).toBeVisible();phase('browser verifies stored byte hash and version');
 const rows=await (await page.request.get('/backend/runs')).json() as {id:string}[];const other=rows.find(row=>row.id!==id)!;await page.locator('.runs button').filter({hasText:other.id.slice(0,8)}).click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+other.id);await expect(page.getByText('SHA-256 '+proof!.contentSha256,{exact:true})).toHaveCount(0);phase('selection change clears archived proof');
});


test('viewer follows a scoped pgvector neighbor without retaining old evidence',async({page})=>{
 await login(page,'demo-viewer');const rows=await (await page.request.get('/backend/runs')).json() as {id:string;state:string}[];const source=rows.find(row=>row.state==='succeeded')!;let target='';
 await expect.poll(async()=>{const response=await page.request.get('/backend/runs/'+source.id+'/similar');if(response.status()===200){const value=await response.json();target=value.matches[0].runId;return true}expect(response.status()).toBe(409);return false},{timeout:30000}).toBe(true);
 await page.locator('.runs button').filter({hasText:source.id.slice(0,8)}).click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+source.id);await page.getByRole('button',{name:'유사 근거 찾기',exact:true}).click();await expect(page.locator('.similar li button').first()).toContainText(target.slice(0,8));await page.locator('.similar li button').first().click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+target);await expect(page.locator('.similar li button')).toHaveCount(0);await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);phase('viewer navigates real scoped vector neighbor and clears previous search');
});

if(process.env.STACK_E2E_LOCAL_MODEL==='true')test('reference dataset is registered and independently graded through actual browser controls',async({page})=>{
 test.setTimeout(150000);await login(page,'demo-admin');const suffix=crypto.randomUUID().replaceAll('-','').slice(0,12),agentKey='browser-ref-agent-'+suffix,datasetKey='browser-ref-data-'+suffix;
 await page.getByLabel('에이전트 이름',{exact:true}).fill(agentKey);await page.getByLabel('에이전트 평가 방식',{exact:true}).selectOption('reference-answer');await page.getByLabel('에이전트 공급자',{exact:true}).selectOption('ollama');
 await page.getByRole('button',{name:'에이전트 버전 고정',exact:true}).click();await expect(page.getByText('고정 버전 확인: '+agentKey+' / v1',{exact:false})).toBeVisible();phase('browser verified immutable reference agent and actual execution profile');
 await page.getByLabel('데이터셋 이름',{exact:true}).fill(datasetKey);await page.getByLabel('데이터셋 평가 방식',{exact:true}).selectOption('reference-answer');await page.getByLabel('평가 입력 1',{exact:true}).fill('Respond exactly with {"answer":"GREEN"}.');await page.getByLabel('기대 정답 1',{exact:true}).fill('GREEN');
 await page.getByRole('button',{name:'데이터셋 버전 고정',exact:true}).click();await expect(page.getByText('고정 버전 확인: '+datasetKey+' / v1',{exact:false})).toBeVisible();
 const agentId=await page.getByLabel('캠페인 에이전트 버전',{exact:true}).locator('option').filter({hasText:agentKey}).getAttribute('value'),datasetId=await page.getByLabel('캠페인 데이터셋 버전',{exact:true}).locator('option').filter({hasText:datasetKey}).getAttribute('value');
 await page.getByLabel('캠페인 에이전트 버전',{exact:true}).selectOption(agentId!);await page.getByLabel('캠페인 데이터셋 버전',{exact:true}).selectOption(datasetId!);await page.getByRole('button',{name:'캠페인 실행',exact:true}).click();
 await expect(page.getByRole('heading',{name:'캠페인 관리자 검토',exact:true})).toBeVisible({timeout:100000});await expect(page.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();
 const region=page.locator('section[aria-label="버전과 평가 캠페인"]'),text=await region.locator('p.mono').filter({hasText:/^캠페인 /}).textContent(),id=text!.match(/[a-f0-9-]{36}/)![0];
 const record=await (await page.request.get('/backend/campaigns/'+id)).json();expect(record.agentVersion.definition.contract).toBe('reference-answer-v1');expect(record.datasetVersion.definition.cases[0].expected).toBe('GREEN');
 const child=await (await page.request.get('/backend/runs/'+record.cases[0].runId)).json();expect(child.result.executionEngine).toBe('python-ollama');expect(child.result.rules.some((r:{id:string;status:string})=>r.id==='verifier-agreement'&&r.status==='pass')).toBe(true);phase('actual Python model and Promptfoo agree; browser shows no release authority before approval');
 await page.getByLabel('캠페인 검토 사유',{exact:true}).fill('Actual reference dataset browser review');await page.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(page.getByText('캠페인 릴리스 허용',{exact:true})).toBeVisible();
 await expect.poll(async()=>(await page.request.get('/backend/campaigns/'+id+'/evidence')).status(),{timeout:45000}).toBe(200);await page.getByRole('button',{name:'캠페인 보관 근거 확인',exact:true}).click();await expect(page.getByText('캠페인과 1개 사례의 브라우저 바이트 해시 검증 완료',{exact:true})).toBeVisible();
 await page.getByLabel('캠페인 검토 결정',{exact:true}).selectOption('rejected');await page.getByLabel('캠페인 검토 사유',{exact:true}).fill('Current rejection after immutable reference archive');await page.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(page.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('reference archive hashes verified in browser; latest rejection denies release');
});

if(process.env.STACK_E2E_LOCAL_MODEL==='true')test('local model provider evidence survives browser approval and archive verification',async({page})=>{
 test.setTimeout(120000);await login(page,'demo-admin');await page.getByLabel('실행 공급자',{exact:true}).selectOption('ollama');await page.getByRole('button',{name:'평가 실행',exact:true}).click();
 await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toBeVisible({timeout:90000});await expect(page.getByText('실행 공급자 ollama · 실행 엔진 python-ollama',{exact:true})).toBeVisible();
 await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();await page.getByLabel('검토 사유',{exact:true}).fill('Actual local model browser review');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('합성 릴리스 허용',{exact:true})).toBeVisible();
 const selected=await page.locator('.evidence > .mono').textContent();const id=selected!.replace('실행 ','');let digest='';
 await expect.poll(async()=>{const response=await page.request.get('/backend/runs/'+id+'/evidence');if(response.status()===200){digest=(await response.json()).contentSha256;return true}expect(response.status()).toBe(409);return false},{timeout:30000}).toBe(true);
 await page.getByRole('button',{name:'근거 해시·버전 확인',exact:true}).click();await expect(page.getByText('SHA-256 '+digest,{exact:true})).toBeVisible();phase('real Ollama admission and engine match; browser verifies provider-bound archive');
 await page.getByLabel('결정',{exact:true}).selectOption('rejected');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('model pass never overrides current rejection');
});


test('administrator cancels a real pending evaluation and campaign through browser controls',async({page})=>{
 await login(page,'demo-admin');
 const worker='agenttrust-stack-ai-worker-1';
 const running=execFileSync('docker',['inspect',worker,'--format','{{.State.Running}}'],{encoding:'utf8',timeout:15000}).trim();expect(running).toBe('true');
 try{
  execFileSync('docker',['stop','--time','10',worker],{timeout:25000});
  await page.getByRole('button',{name:'평가 실행',exact:true}).click();
  await expect(page.getByLabel('평가 취소 사유',{exact:true})).toBeVisible();
  await page.getByLabel('평가 취소 사유',{exact:true}).fill('Browser synthetic cancellation');
  await page.getByRole('button',{name:'평가 취소',exact:true}).click();
  await expect(page.getByText('평가 취소 결과를 확인했습니다.',{exact:true})).toBeVisible();
  await expect(page.locator('.evidence').getByText(/실행 엔진 java-cancelled/)).toBeVisible();
  await expect(page.locator('.evidence .similar').getByRole('button',{name:'유사 근거 찾기',exact:true})).toBeDisabled();
  await expect(page.getByText('취소된 평가는 유사 근거 검색 대상이 아닙니다.',{exact:true})).toBeVisible();
  await expect(page.locator('.evidence .gate').getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'평가 취소',exact:true})).toHaveCount(0);
  const csrf=(await (await page.request.get('/backend/csrf')).json()).token,headers={'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'};
  const suffix=crypto.randomUUID().slice(0,8);
  const a=await page.request.post('/backend/versions/agents',{headers,data:{key:'browser-cancel-agent-'+suffix,version:1,provider:'synthetic',description:'Browser cancellation fixture'}});expect(a.status()).toBe(200);const agent=await a.json();
  const d=await page.request.post('/backend/versions/datasets',{headers,data:{key:'browser-cancel-data-'+suffix,version:1,cases:[{id:'required',scenario:'pass',required:true}]}});expect(d.status()).toBe(200);const dataset=await d.json();
  const c=await page.request.post('/backend/campaigns',{headers:{...headers,'Idempotency-Key':crypto.randomUUID()},data:{agentVersionId:agent.id,datasetVersionId:dataset.id,requiresApproval:true}});expect(c.status()).toBe(200);const campaign=await c.json();
  await page.reload();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
  const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
  await region.getByRole('button',{name:'캠페인 '+campaign.id.slice(0,8),exact:true}).click();
  await region.getByLabel('캠페인 취소 사유',{exact:true}).fill('Browser pending campaign cancellation');
  await region.getByRole('button',{name:'미완료 사례 취소',exact:true}).click();
  await expect(region.getByText('캠페인의 미완료 사례 취소를 확인했습니다.',{exact:true})).toBeVisible();
  const saved=await (await page.request.get('/backend/campaigns/'+campaign.id)).json();expect(saved.state).toBe('failed');expect(saved.decision).toBe('inconclusive');
  expect((await (await page.request.get('/backend/campaigns/'+campaign.id+'/gate')).json()).deploymentAllowed).toBe(false);
  phase('actual browser verifies terminal cancellation and denied release for run and campaign');
 }finally{execFileSync('docker',['start',worker],{timeout:25000});phase('dedicated worker restored');}
});


test('viewer opens existing campaign history and clears a foreign filtered page',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 캠페인 이력',exact:true});
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();
 await expect(region.locator('[data-campaign-history-id]').first()).toBeVisible();
 const first=await region.locator('[data-campaign-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-campaign-history-id')));
 let selected=first[0]!;
 if(await region.getByRole('button',{name:'다음 캠페인 페이지',exact:true}).isEnabled()){
  await region.getByRole('button',{name:'다음 캠페인 페이지',exact:true}).click();await expect(region.getByText(/캠페인 이력 페이지 2/)).toBeVisible();
  const second=await region.locator('[data-campaign-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-campaign-history-id')));expect(second.length).toBeGreaterThan(0);expect(second.some(id=>first.includes(id))).toBe(false);selected=second[0]!;
 }
 await region.getByRole('button',{name:'캠페인 근거 '+selected.slice(0,8),exact:true}).click();
 await expect(page.getByText('캠페인 '+selected,{exact:true})).toBeVisible();
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();await expect(region.locator('[data-campaign-history-id]').first()).toBeVisible();
 const request=await page.request.get('/backend/campaigns/'+selected),record=await request.json();
 const snapshot=await (await page.request.get('/backend/campaign-history/dataset/'+record.dataset_version_id)).json();
 await page.route('**/backend/campaign-history/dataset/'+record.dataset_version_id,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,organizationId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}));
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();
 await expect(region.getByText('캠페인 이력을 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();await expect(region.locator('[data-campaign-history-id]')).toHaveCount(0);
 phase('actual campaign history opens existing frozen evidence and refuses foreign dataset response');
});

test('viewer selects an existing historical baseline and verifies a real campaign comparison',async({page})=>{
 const folder=resolve(process.cwd(),'../../.local');
 const proof=readdirSync(folder).filter(name=>name.startsWith('stack-campaign-smoke-')&&name.endsWith('.json')).map(name=>({path:resolve(folder,name),at:statSync(resolve(folder,name)).mtimeMs})).sort((a,b)=>b.at-a.at).map(file=>JSON.parse(readFileSync(file.path,'utf-8'))).find(value=>value.completed&&value.campaignId&&value.comparisonCampaignId);
 expect(proof).toBeTruthy();await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 캠페인 이력',exact:true});
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();await expect(region.locator('[data-campaign-history-id]').first()).toBeVisible();
 const candidate=region.getByRole('button',{name:'캠페인 근거 '+proof.campaignId.slice(0,8),exact:true});
 for(let attempt=0;attempt<8&&!await candidate.count();attempt++){
  await expect(region.getByRole('button',{name:'다음 캠페인 페이지',exact:true})).toBeEnabled();await region.getByRole('button',{name:'다음 캠페인 페이지',exact:true}).click();await expect(region.getByText(new RegExp('캠페인 이력 페이지 '+(attempt+2)+' '))).toBeVisible();
 }
 await candidate.click();await expect(page.getByText('캠페인 '+proof.campaignId,{exact:true})).toBeVisible();
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();await expect(region.locator('[data-campaign-history-id]').first()).toBeVisible();
 await region.getByRole('button',{name:'비교 기준 '+proof.comparisonCampaignId.slice(0,8)+' 선택',exact:true}).click();
 await expect(page.getByLabel('비교 기준 캠페인',{exact:true})).toHaveValue(proof.comparisonCampaignId);
 const response=page.waitForResponse(value=>value.url().endsWith('/comparison/'+proof.comparisonCampaignId)&&value.request().method()==='GET');
 await page.getByRole('button',{name:'캠페인 회귀 비교',exact:true}).click();expect((await response).status()).toBe(200);
 await expect(page.getByText(/새 필수 실패: 없음/)).toBeVisible();
 phase('read-only historical dataset navigation supplies the real baseline to Java comparison verification');
});


test('viewer checks real evaluation dependencies and clears untrusted or unavailable observations',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'평가 경로 준비 상태',exact:true});
 await region.getByRole('button',{name:'평가 경로 상태 확인',exact:true}).click();
 await expect(region.getByText('평가 경로 연결 확인 완료',{exact:true})).toBeVisible();
 await expect(region.getByText('Python 평가 워커·NATS 큐 · 연결 확인',{exact:true})).toBeVisible();
 const snapshot=await (await page.request.get('/backend/evaluation-readiness')).json();
 await page.route('**/backend/evaluation-readiness',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({...snapshot,ready:false,dependencies:snapshot.dependencies.map((d:{name:string;available:boolean})=>({...d,available:d.name!=='worker-queue'}))})}));
 await region.getByRole('button',{name:'평가 경로 상태 확인',exact:true}).click();
 await expect(region.getByText('Python 평가 워커·NATS 큐 · 확인 불가',{exact:true})).toBeVisible();
 await page.unroute('**/backend/evaluation-readiness');
 await page.route('**/backend/evaluation-readiness',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,projectId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}));
 await region.getByRole('button',{name:'평가 경로 상태 확인',exact:true}).click();
 await expect(region.getByText('준비 상태를 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();
 await expect(region.locator('time')).toHaveCount(0);await expect(region.locator('li')).toHaveCount(0);
 phase('actual ready dependency response, simulated unavailable rendering and foreign-scope clearing verified');
});


test('viewer verifies an older registered version before selecting it for campaign preparation',async({page})=>{
 await login(page,'demo-viewer');
 for(const [kind,label,selectLabel] of [['agents','에이전트','캠페인 에이전트 버전'],['datasets','데이터셋','캠페인 데이터셋 버전']] as const){
  const region=page.getByRole('region',{name:'프로젝트 '+label+' 버전 이력',exact:true});
  await region.getByRole('button',{name:label+' 버전 이력 조회',exact:true}).click();await expect(region.locator('[data-version-history-id]').first()).toBeVisible();
  const first=await region.locator('[data-version-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-version-history-id')));
  if(await region.getByRole('button',{name:'다음 '+label+' 버전 페이지',exact:true}).isEnabled()){
   await region.getByRole('button',{name:'다음 '+label+' 버전 페이지',exact:true}).click();await expect(region.getByText(new RegExp(label+' 버전 페이지 2 '))).toBeVisible();
   const older=await region.locator('[data-version-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-version-history-id')));expect(older.some(id=>first.includes(id))).toBe(false);
  }
  const row=region.locator('[data-version-history-id]').last(),id=await row.getAttribute('data-version-history-id');
  const response=page.waitForResponse(r=>r.url().endsWith('/versions/'+kind+'/'+id)&&r.request().method()==='GET');await row.getByRole('button',{name:new RegExp('^'+label+' 버전 .* 선택$')}).click();expect((await response).status()).toBe(200);
  await expect(region.getByText(/내용·해시·활성 상태 확인 후 선택:/)).toBeVisible();await expect(page.getByLabel(selectLabel,{exact:true})).toHaveValue(id!);
  if(!first.includes(id)){await region.getByRole('button',{name:'이전 '+label+' 버전 페이지',exact:true}).click();await expect(region.getByText(new RegExp(label+' 버전 페이지 1 '))).toBeVisible();expect(await region.locator('[data-version-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-version-history-id')))).toEqual(first);}
  const alternateId=first.find(value=>value!==id);expect(alternateId).toBeTruthy();const alternate=region.locator('[data-version-history-id="'+alternateId+'"]');expect(alternateId).not.toBe(id);
  const detail=await (await page.request.get('/backend/versions/'+kind+'/'+alternateId)).json(),match=/^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/.exec(detail.created_at);expect(match).not.toBeNull();
  const nanos=Number((match![2]??'').padEnd(9,'0')),changed=nanos%1000000===999000?nanos-1000:nanos+1000,created_at=match![1]+'.'+String(changed).padStart(9,'0')+'Z';expect(Date.parse(created_at)).toBe(Date.parse(detail.created_at));
  const detailRoute='**/backend/versions/'+kind+'/'+alternateId;await page.route(detailRoute,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...detail,created_at})}));
  try{await alternate.getByRole('button',{name:new RegExp('^'+label+' 버전 .* 선택$')}).click();await expect(region.getByText('버전 내용과 해시·활성 상태를 확인하지 못했습니다. 선택을 적용하지 않았습니다.',{exact:true})).toBeVisible();await expect(page.getByLabel(selectLabel,{exact:true})).toHaveValue(id!)}finally{await page.unroute(detailRoute)}
  phase(kind+' detail with a one-microsecond metadata substitution is refused while the earlier verified selection remains');
  const snapshot=await (await page.request.get('/backend/version-history/'+kind)).json();await page.route('**/backend/version-history/'+kind,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,kind:kind==='agents'?'datasets':'agents'})}));
  await region.getByRole('button',{name:label+' 버전 이력 조회',exact:true}).click();await expect(region.getByText('버전 이력을 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();await expect(region.locator('[data-version-history-id]')).toHaveCount(0);await expect(page.getByLabel(selectLabel,{exact:true})).toHaveValue(id!);await page.unroute('**/backend/version-history/'+kind);
 }
 phase('actual immutable version content/hash checked before controlled selection; foreign-kind page refused');
});


test('mobile reviewer reads actual readiness and immutable version history without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await login(page,'demo-viewer');
 const ready=page.getByRole('region',{name:'평가 경로 준비 상태',exact:true});await ready.getByRole('button',{name:'평가 경로 상태 확인',exact:true}).click();await expect(ready.getByText('평가 경로 연결 확인 완료',{exact:true})).toBeVisible();
 for(const label of ['에이전트','데이터셋']){const region=page.getByRole('region',{name:'프로젝트 '+label+' 버전 이력',exact:true});await region.getByRole('button',{name:label+' 버전 이력 조회',exact:true}).click();await expect(region.locator('[data-version-history-id]').first()).toBeVisible();expect(await region.evaluate(element=>element.scrollWidth<=element.clientWidth+2)).toBe(true);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 phase('390px actual scoped readiness and version navigation have no horizontal overflow');
});


test('a stalled current gate request times out and a fresh retry verifies the actual signature',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];let selected:string|null=null;
 for(const row of records){const record=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(record.state==='succeeded'&&(await page.request.get('/backend/campaigns/'+row.id+'/evidence')).ok()){selected=row.id;break}}
 expect(selected).not.toBeNull();await region.getByRole('button',{name:'캠페인 '+selected!.slice(0,8),exact:true}).click();
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});let received!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{received=resolve}),held=new Promise<void>(resolve=>{release=resolve});
 const routePattern='**/backend/campaigns/'+selected+'/gate-check/*';
 await page.route(routePattern,async route=>{received();await held;try{await route.abort()}catch{/* request already aborted by the component deadline */}});
 try{await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await ready;await expect(checks.getByRole('status')).toContainText('서명·범위·유효 시간을 확인하지 못했습니다.',{timeout:15000});await expect(checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true})).toBeEnabled();await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0)}finally{release();await page.unroute(routePattern)}
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();
 phase('stalled request releases busy state at the bounded deadline; actual fresh Java signature verifies on retry');
});


test('viewer recovers from a stalled evaluation detail without retaining prior evidence',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 평가 이력',exact:true});await region.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();const row=region.locator('[data-run-history-id]').first();const id=await row.getAttribute('data-run-history-id');expect(id).toBeTruthy();const button=row.getByRole('button',{name:'평가 근거 '+id!.slice(0,8),exact:true});await button.click();await expect(page.locator('.evidence').getByText('실행 '+id,{exact:true})).toBeVisible();
 const path='**/backend/runs/'+id;let release!:()=>void,started!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{started=resolve}),done=new Promise<void>(resolve=>{finished=resolve});
 await page.route(path,async route=>{const response=await route.fetch();started();await held;try{await route.fulfill({response})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{finished()}});
 try{await button.click();await entered;await expect(page.locator('.evidence')).toHaveCount(0);await expect(page.getByText('평가 근거를 확인하지 못했습니다. 다시 선택해 주세요.',{exact:true})).toBeVisible({timeout:12000});release();await done;await expect(page.locator('.evidence')).toHaveCount(0)}finally{release();await page.unroute(path)}
 await button.click();await expect(page.locator('.evidence').getByText('실행 '+id,{exact:true})).toBeVisible();phase('actual ten-second detail deadline clears prior evidence and permission; late response remains refused and a manual scoped API retry recovers; no business writes');
 const gatePath='**/backend/runs/'+id+'/gate';let releaseGate!:()=>void,gateStarted!:()=>void,gateFinished!:()=>void;const gateHeld=new Promise<void>(resolve=>{releaseGate=resolve}),gateEntered=new Promise<void>(resolve=>{gateStarted=resolve}),gateDone=new Promise<void>(resolve=>{gateFinished=resolve});
 await page.route(gatePath,async route=>{const response=await route.fetch();gateStarted();await gateHeld;try{await route.fulfill({response})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{gateFinished()}});
 try{await button.click();await gateEntered;await expect(page.locator('.evidence')).toHaveCount(0);await expect(page.getByText('평가 근거를 확인하지 못했습니다. 다시 선택해 주세요.',{exact:true})).toBeVisible({timeout:12000});releaseGate();await gateDone;await expect(page.locator('.evidence')).toHaveCount(0)}finally{releaseGate();await page.unroute(gatePath)}
 await button.click();await expect(page.locator('.evidence').getByText('실행 '+id,{exact:true})).toBeVisible();phase('a stalled real OPA gate response shares the detail deadline and cannot display partially verified evidence or earlier permission; manual retry recovers');

});


test('viewer recovers bounded archive and similarity reads after stalled responses',async({page})=>{
 await login(page,'demo-viewer');
 const frame=await (await page.request.get('/backend/audit-search/evaluation.completed/all')).json();const id=frame.entries[0].resourceId;const value=await (await page.request.get('/backend/runs/'+id)).json();expect(value.state).not.toBe('queued');
 const history=page.getByRole('region',{name:'프로젝트 평가 이력',exact:true});await history.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();
 const audit=page.getByRole('region',{name:'감사 기록 검색',exact:true});await audit.getByLabel('감사 작업 종류',{exact:true}).selectOption('evaluation.completed');await audit.getByLabel('감사 대상 ID',{exact:true}).fill(id);await audit.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await audit.getByRole('button',{name:'평가 근거 '+id.slice(0,8),exact:true}).first().click();await expect(page.locator('.evidence').getByText('실행 '+id,{exact:true})).toBeVisible();
 for(const item of [{suffix:'evidence',button:'근거 해시·버전 확인',failure:'보관된 근거를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.'},{suffix:'similar',button:'유사 근거 찾기',failure:'유사 근거를 조회하지 못했습니다. 색인 준비 후 다시 확인해 주세요.'}]){
  const path='**/backend/runs/'+id+'/'+item.suffix;let release!:()=>void,started!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{started=resolve}),done=new Promise<void>(resolve=>{finished=resolve});const button=page.locator('.evidence').getByRole('button',{name:item.button,exact:true});
  await page.route(path,async route=>{const response=await route.fetch();started();await held;try{await route.fulfill({response})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{finished()}});
  try{await button.click();await entered;await expect(button).toBeDisabled();await expect(page.getByText(item.failure,{exact:true})).toBeVisible({timeout:12000});await expect(button).toBeEnabled();release();await done;await expect(page.getByText(item.failure,{exact:true})).toBeVisible()}finally{release();await page.unroute(path)}
  await button.click();await expect(button).toBeEnabled();if(item.suffix==='evidence')await expect(page.getByText('서버와 브라우저의 바이트 해시 검증 완료',{exact:false})).toBeVisible();else await expect(page.getByText('같은 프로젝트의 규칙 특징이 비슷한 평가를 조회했습니다.',{exact:true})).toBeVisible();
 }
 phase('actual ten-second archived-byte and pgvector read deadlines release controls, refuse delayed results and recover through manual real scoped API retries; no business writes');
});
