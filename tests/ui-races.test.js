import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto,generateKeyPairSync } from 'node:crypto';
import {ReceiptSigner,verifyReceipt} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';

// Execute the actual UI handlers with deferred HTTP responses, without a browser
// dependency or a real network. Only DOM operations used by this UI are modeled.
class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.handlers={};this.value='';this.disabled=false;this.hidden=false;this.text='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join(' ');}
  replaceChildren(...children){this.text='';this.children=children;if(this.tag==='select')this.value=children[0]?.value||'';}
  append(...children){this.children.push(...children);}
  click(){}
  addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
  async fire(type,event={}){for(const handler of this.handlers[type]||[])await handler({preventDefault(){},...event});}
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('obsolete dataset copy failure preserves a new workspace draft and status',async()=>{
 const f=await fixture(),reply=deferred();f.overrides.set('/v1/versions/dataset',async()=>{await reply.promise;throw Error('Old synthetic copy failure');});
 const pending=f.element('dataset-copy').fire('click');await settle();await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');
 f.element('dataset-json').value='New workspace draft';f.element('status').textContent='New workspace status';reply.resolve();await pending;
 assert.equal(f.element('dataset-json').value,'New workspace draft');assert.equal(f.element('status').textContent,'New workspace status');
 f.overrides.set('/v1/versions/dataset',()=>({data:{name:'Current synthetic dataset',cases:[]}}));await f.element('dataset-copy').fire('click');assert.equal(JSON.parse(f.element('dataset-json').value).name,'Current synthetic dataset 복사');assert.equal(f.element('dataset-copy').disabled,false);
});

test('obsolete operations failure cannot unlock a new workspace refresh',async()=>{
 const f=await fixture(),older=deferred(),newer=deferred();let calls=0;
 f.overrides.set('/v1/operations',async()=>{const call=++calls;if(call===1){await older.promise;throw Error('Old synthetic operation failure');}return newer.promise;});
 const oldRequest=f.element('operations-refresh').fire('click');await settle();await f.element('logout-button').fire('click');f.overrides.delete('/v1/operations');await f.element('login-form').fire('submit');f.overrides.set('/v1/operations',()=>{calls++;return newer.promise;});
 const newRequest=f.element('operations-refresh').fire('click');await settle();assert.equal(calls,2);f.element('status').textContent='Current operation status';older.resolve();await oldRequest;
 assert.equal(f.element('operations-refresh').disabled,true);assert.equal(f.element('status').textContent,'Current operation status');
 newer.resolve({worker:{state:'recent',lastSeen:null},queue:{queued:2,running:0,overdue:0,expiredLeases:0},recent:{completed24h:2,errors24h:0},observedAt:'2026-01-01T00:00:00Z'});await newRequest;
 assert.equal(f.element('operations-refresh').disabled,false);assert.equal(f.element('queue-waiting').textContent,'2');
});

test('obsolete historical receipt download failure cannot replace new workspace status',async()=>{
 const f=await fixture(),reply=deferred();f.overrides.set('/v1/release-receipts?limit=25',()=>({items:[{id:'synthetic-receipt',decision:'block',created_at:'2026-01-01T00:00:00Z',candidate_run_id:'synthetic-run',signing_key_id:'synthetic'}],nextCursor:null}));
 await f.element('receipts-refresh').fire('click');const button=f.element('receipt-list').children[0].children.at(-1);
 f.overrides.set('/v1/release-receipts/synthetic-receipt',async()=>{await reply.promise;throw Error('Old synthetic receipt failure');});const pending=button.fire('click');await settle();await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');
 f.element('status').textContent='New receipt workspace';reply.resolve();await pending;assert.equal(f.element('status').textContent,'New receipt workspace');assert.equal(f.downloads.length,0);
 const currentButton=f.element('receipt-list').children[0].children.at(-1);f.overrides.set('/v1/release-receipts/synthetic-receipt',()=>({id:'synthetic-receipt',synthetic:true}));await currentButton.fire('click');assert.equal(f.downloads.length,1);assert.equal(JSON.parse(await f.downloads[0].text()).synthetic,true);assert.equal(currentButton.disabled,false);
});
function execution(id,state='succeeded',manual=false){return {id,state,createdAt:'2026-01-01T00:00:00Z',snapshotHash:'synthetic-'+id,
  snapshot:{agent:{name:'Run '+id},dataset:{name:'Synthetic dataset'},policy:{name:'Synthetic policy',requiresManualApproval:manual}},
  agentVersionId:'agent',datasetVersionId:'dataset',policyVersionId:'policy',results:[],summary:{cases:0,pass:0,fail:0,inconclusive:0},
  gate:{decision:state==='succeeded'?'pass':'inconclusive',deploymentAllowed:state==='succeeded'&&!manual,...(manual?{requiresManualApproval:true,evaluationPassed:state==='succeeded'}:{})}};}
async function fixture({manual=false,initialOverrides,waitForInitialization=true,timeoutSignal=ms=>AbortSignal.timeout(ms)}={}){
  const nodes=new Map(),selects=new Set(['agent','dataset-select','policy','workspace-project','ci-project','baseline-run','gate-baseline-recent','history-state','history-decision','audit-action','agent-mode']);
  const element=id=>{if(!nodes.has(id))nodes.set(id,new Element(selects.has(id)?'select':'div'));return nodes.get(id);};
  const document={getElementById:element,createElement:tag=>new Element(tag)},timers=[],overrides=new Map(initialOverrides||[]),downloads=[];
  element('workspace-ui').hidden=true;element('login-panel').hidden=true;element('loading-panel').hidden=false;element('login-button').disabled=true;
  element('timeout-ms').value='30000';element('case-budget').value='100';
  const runs={A:execution('A','running'),B:execution('B','succeeded',manual)};
  const defaultResponse=path=>{
    if(path==='/v1/me')return {role:'admin',projectId:'project',organizationName:'Synthetic',name:'Tester',projects:[{id:'project',name:'Synthetic'}]};
    if(path==='/v1/catalog')return {agent:[{id:'agent',name:'Agent',mode:'compliant'}],dataset:[{id:'dataset',name:'Dataset',cases:1}],policy:[{id:'policy',name:'Policy',minimumPassRate:1}]};
    if(path==='/v1/sample-dataset')return {name:'Synthetic',cases:[]};
    if(path.startsWith('/v1/runs?'))return {items:Object.values(runs).map(run=>({id:run.id,agentName:'Run '+run.id,datasetName:'Dataset',state:run.state,gate:run.gate,createdAt:run.createdAt})),nextCursor:null};
    if(path==='/v1/operations')return {worker:{state:'recent',lastSeen:null},queue:{queued:1,running:0,overdue:0,expiredLeases:0},recent:{completed24h:1,errors24h:0},observedAt:'2026-01-01T00:00:00Z'};
    if(path==='/v1/usage')return {completed_runs:1,evaluated_cases:1,attempts:1};
    if(path.startsWith('/v1/runs/')&&path.includes('/reviews'))return path.includes('?')?{items:[],nextCursor:null}:[];
    if(path.startsWith('/v1/runs/'))return runs[path.split('/')[3]];
    return {items:[],nextCursor:null};
  };
  const fetch=async(path,options={})=>{const handler=overrides.get(path),data=handler?await handler(options):defaultResponse(path);return data instanceof Response?data:new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};
  const source=await readFile(new URL('../apps/web/app.js',import.meta.url),'utf8');
  const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  const initialized=new AsyncFunction('document','fetch','setTimeout','crypto','URL','AbortSignal',source)(document,fetch,callback=>{timers.push(callback);},webcrypto,{createObjectURL:blob=>{downloads.push(blob);return 'blob:synthetic';},revokeObjectURL(){}},{timeout:timeoutSignal});
  if(waitForInitialization)await initialized;
  const view=id=>{const row=element('history-body').children.find(row=>row.children[0].textContent==='Run '+id);return row.children.at(-1).children[0].fire('click');};
  return {element,overrides,timers,runs,view,downloads,initialized};
}

test('late cancellation response cannot replace a newly selected run',async()=>{
  const f=await fixture(),cancel=deferred();f.overrides.set('/v1/runs/A/cancel',()=>cancel.promise);
  const firstView=f.view('A');await settle();assert.ok(f.element('snapshot').textContent.includes('실행 A'));
  const cancelling=f.element('cancel-button').fire('click');await settle();await f.view('B');
  cancel.resolve(execution('A','cancelled'));await cancelling;
  assert.ok(f.element('snapshot').textContent.includes('실행 B'));assert.equal(f.element('run-state').textContent,'평가 완료');
  for(const callback of f.timers.splice(0))callback();await firstView;
});

test('obsolete cancellation completion preserves the status of a new run selection',async()=>{
 const f=await fixture(),cancel=deferred();const viewing=f.view('A');await settle();
 f.overrides.set('/v1/runs/A/cancel',()=>cancel.promise);const pending=f.element('cancel-button').fire('click');await settle();await f.view('B');
 f.element('status').textContent='New selection status';cancel.resolve(execution('A','cancelled'));await pending;
 assert.equal(f.element('status').textContent,'New selection status');
 for(const callback of f.timers.splice(0))callback();await viewing;
});

test('obsolete cancellation failure cannot replace the status after logout',async()=>{
 const f=await fixture(),cancel=deferred();const viewing=f.view('A');await settle();
 f.overrides.set('/v1/runs/A/cancel',async()=>{await cancel.promise;throw Error('Synthetic old cancellation failure');});
 const pending=f.element('cancel-button').fire('click');await settle();await f.element('logout-button').fire('click');
 f.element('status').textContent='New login status';cancel.resolve();await pending;assert.equal(f.element('status').textContent,'New login status');
 for(const callback of f.timers.splice(0))callback();await viewing;
});

test('same-run reselection keeps freshly read state when an older cancellation resolves',async()=>{
 const f=await fixture(),cancel=deferred();const viewing=f.view('A');await settle();
 f.overrides.set('/v1/runs/A/cancel',()=>cancel.promise);const pending=f.element('cancel-button').fire('click');await settle();
 f.runs.A=execution('A','succeeded');await f.view('A');assert.equal(f.element('run-state').textContent,'평가 완료');
 cancel.resolve(execution('A','cancelled'));await pending;assert.equal(f.element('run-state').textContent,'평가 완료');
 for(const callback of f.timers.splice(0))callback();await viewing;
});

test('polling cannot unlock or duplicate a pending cancellation of the selected run',async()=>{
 const f=await fixture(),reply=deferred();const viewing=f.view('A');await settle();let calls=0;
 f.overrides.set('/v1/runs/A/cancel',()=>{calls++;return reply.promise;});const cancelling=f.element('cancel-button').fire('click');await settle();
 for(const callback of f.timers.splice(0))callback();await settle();assert.equal(f.element('cancel-button').disabled,true);await f.element('cancel-button').fire('click');assert.equal(calls,1);
 f.runs.A=execution('A','cancelled');reply.resolve(f.runs.A);await cancelling;assert.match(f.element('status').textContent,/취소했습니다/);assert.equal(f.element('cancel-button').disabled,true);for(const callback of f.timers.splice(0))callback();await viewing;
});

test('completion winning a cancellation race is reported as the actual terminal state',async()=>{
 for(const state of ['succeeded','failed','timed_out']){
  const f=await fixture(),reply=deferred(),viewing=f.view('A');await settle();f.overrides.set('/v1/runs/A/cancel',()=>reply.promise);const cancelling=f.element('cancel-button').fire('click');await settle();
  f.runs.A=execution('A',state);reply.resolve(f.runs.A);await cancelling;assert.ok(!f.element('status').textContent.includes('취소했습니다'));assert.match(f.element('status').textContent,/이미 종료/);assert.ok(f.element('status').textContent.includes(f.element('run-state').textContent));assert.equal(f.element('cancel-button').disabled,true);for(const callback of f.timers.splice(0))callback();await viewing;
 }
});

test('failed cancellation releases only its current lock and requires an explicit retry',async()=>{
 const f=await fixture(),viewing=f.view('A');await settle();let calls=0;
 f.overrides.set('/v1/runs/A/cancel',()=>{calls++;throw Error('Synthetic cancellation failure');});await f.element('cancel-button').fire('click');assert.equal(calls,1);assert.equal(f.element('cancel-button').disabled,false);assert.match(f.element('status').textContent,/기록을 조회/);
 f.runs.A=execution('A','cancelled');f.overrides.set('/v1/runs/A/cancel',()=>{calls++;return f.runs.A;});await f.element('cancel-button').fire('click');assert.equal(calls,2);assert.equal(f.element('cancel-button').disabled,true);for(const callback of f.timers.splice(0))callback();await viewing;
});

test('an older cancellation cannot unlock a new selected execution cancellation',async()=>{
 const f=await fixture(),older=deferred(),newer=deferred(),first=f.view('A');await settle();f.overrides.set('/v1/runs/A/cancel',()=>older.promise);const oldRequest=f.element('cancel-button').fire('click');await settle();
 f.runs.B=execution('B','running');const second=f.view('B');await settle();f.overrides.set('/v1/runs/B/cancel',()=>newer.promise);const newRequest=f.element('cancel-button').fire('click');await settle();
 older.resolve(execution('A','cancelled'));await oldRequest;assert.equal(f.element('cancel-button').disabled,true);
 f.runs.B=execution('B','cancelled');newer.resolve(f.runs.B);await newRequest;assert.match(f.element('status').textContent,/실행 B을 취소/);for(const callback of f.timers.splice(0))callback();await Promise.all([first,second]);
});

test('an old execution request cannot keep a new workspace locked or clear its active request',async()=>{
 const f=await fixture(),older=deferred(),newer=deferred();let calls=0;
 f.overrides.set('/v1/runs',()=>++calls===1?older.promise:newer.promise);
 const oldRequest=f.element('run-form').fire('submit');await settle();
 await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');assert.equal(f.element('run-button').disabled,false);
 const newRequest=f.element('run-form').fire('submit');await settle();assert.equal(calls,2);const status=f.element('status').textContent;
 older.resolve(execution('A'));await oldRequest;assert.equal(f.element('status').textContent,status);assert.equal(f.element('run-button').disabled,true);
 newer.resolve(execution('B'));await newRequest;assert.equal(f.element('run-button').disabled,false);assert.match(f.element('snapshot').textContent,/실행 B/);
});

test('switching selected runs during execution polling does not announce an obsolete completion',async()=>{
 const f=await fixture();f.overrides.set('/v1/runs',()=>execution('A','running'));
 const pending=f.element('run-form').fire('submit');await settle();await f.view('B');f.element('status').textContent='Current selected run status';
 for(const callback of f.timers.splice(0))callback();await pending;assert.equal(f.element('status').textContent,'Current selected run status');assert.equal(f.element('run-button').disabled,false);
});

test('a pending execution creation preserves an explicit newer run selection',async()=>{
 const f=await fixture(),creation=deferred();f.overrides.set('/v1/runs',()=>creation.promise);
 const pending=f.element('run-form').fire('submit');await settle();await f.view('B');f.element('status').textContent='Explicit current selection';
 creation.resolve(execution('A'));await pending;assert.match(f.element('snapshot').textContent,/실행 B/);assert.equal(f.element('status').textContent,'Explicit current selection');assert.equal(f.element('run-button').disabled,false);
});

test('pending version registration remains locked through unrelated execution completion',async()=>{
 const f=await fixture(),creation=deferred();let registrations=0,otherRegistrations=0;
 f.overrides.set('/v1/agent-versions',()=>{registrations++;return creation.promise;});f.overrides.set('/v1/runs',()=>execution('B'));
 for(const kind of ['dataset','policy'])f.overrides.set('/v1/'+kind+'-versions',()=>{otherRegistrations++;return {id:kind,name:kind};});
 const pending=f.element('agent-form').fire('submit');await settle();assert.equal(f.element('agent-create').disabled,true);
 await f.element('run-form').fire('submit');assert.equal(f.element('agent-create').disabled,true);assert.equal(f.element('policy-create').disabled,true);assert.equal(f.element('dataset-button').disabled,true);
 await f.element('agent-form').fire('submit');assert.equal(registrations,1);
 await f.element('dataset-form').fire('submit');await f.element('policy-form').fire('submit');assert.equal(otherRegistrations,0);
 creation.resolve({id:'agent',name:'Synthetic new agent'});await pending;assert.equal(f.element('agent-create').disabled,false);assert.equal(f.element('policy-create').disabled,false);assert.equal(f.element('dataset-button').disabled,false);
});

test('obsolete version registration cannot change new workspace status or release its lock',async()=>{
 const f=await fixture(),older=deferred(),newer=deferred();let calls=0;
 f.overrides.set('/v1/agent-versions',()=>++calls===1?older.promise:newer.promise);
 const oldRequest=f.element('agent-form').fire('submit');await settle();await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');
 const newRequest=f.element('agent-form').fire('submit');await settle();assert.equal(calls,2);f.element('status').textContent='New version request status';
 older.resolve({id:'agent',name:'Obsolete agent'});await oldRequest;assert.equal(f.element('status').textContent,'New version request status');assert.equal(f.element('agent-create').disabled,true);
 newer.resolve({id:'agent',name:'Current agent'});await newRequest;assert.equal(f.element('agent-create').disabled,false);assert.match(f.element('status').textContent,/Current agent/);
});

test('CI credential issuance excludes overlapping workspace mutations and duplicate issuance',async()=>{
 const f=await fixture(),issuance=deferred();let keys=0,projects=0;
 f.overrides.set('/v1/ci-credentials',()=>{keys++;return issuance.promise;});f.overrides.set('/v1/projects',()=>{projects++;return {id:'project'};});
 const pending=f.element('ci-key-form').fire('submit');await settle();assert.equal(f.element('ci-create').disabled,true);assert.equal(f.element('project-create').disabled,true);
 await f.element('ci-key-form').fire('submit');await f.element('project-form').fire('submit');assert.equal(keys,1);assert.equal(projects,0);
 issuance.resolve({token:'synthetic-issued-key'});await pending;assert.equal(f.element('ci-issued-key').value,'synthetic-issued-key');assert.equal(f.element('ci-create').disabled,false);assert.equal(f.element('project-create').disabled,false);
});

test('obsolete CI issuance cannot release a new workspace operation or display an old token',async()=>{
 const f=await fixture(),older=deferred(),newer=deferred();let calls=0;
 f.overrides.set('/v1/ci-credentials',()=>++calls===1?older.promise:newer.promise);
 const oldRequest=f.element('ci-key-form').fire('submit');await settle();await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');
 const newRequest=f.element('ci-key-form').fire('submit');await settle();assert.equal(calls,2);f.element('ci-status').textContent='Current issuance status';
 older.resolve({token:'obsolete-synthetic-key'});await oldRequest;assert.equal(f.element('ci-status').textContent,'Current issuance status');assert.equal(f.element('ci-create').disabled,true);assert.equal(f.element('logout-button').disabled,true);assert.equal(f.element('ci-issued-key').value,'');
 newer.resolve({token:'current-synthetic-key'});await newRequest;assert.equal(f.element('ci-issued-key').value,'current-synthetic-key');assert.equal(f.element('ci-create').disabled,false);
});

test('project creation retains the workspace lock throughout its own initialization',async()=>{
 const f=await fixture(),hydration=deferred();let keys=0;
 f.overrides.set('/v1/projects',()=>({id:'project'}));f.overrides.set('/v1/me',()=>hydration.promise);f.overrides.set('/v1/ci-credentials',()=>{keys++;return {token:'synthetic-key'};});
 const pending=f.element('project-form').fire('submit');await settle();assert.equal(f.element('project-create').disabled,true);assert.equal(f.element('ci-create').disabled,true);
 await f.element('ci-key-form').fire('submit');assert.equal(keys,0);
 hydration.resolve({role:'admin',projectId:'project',organizationName:'Synthetic',name:'Tester',projects:[{id:'project',name:'Synthetic'}]});await pending;
 assert.equal(f.element('ci-create').disabled,false);assert.equal(f.element('project-create').disabled,false);assert.equal(f.element('workspace-project').disabled,false);
});

test('obsolete project creation preserves a newer CI issuance lock and project draft',async()=>{
 const f=await fixture(),project=deferred(),key=deferred();f.overrides.set('/v1/projects',()=>project.promise);
 const oldRequest=f.element('project-form').fire('submit');await settle();await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');
 f.overrides.set('/v1/ci-credentials',()=>key.promise);const newRequest=f.element('ci-key-form').fire('submit');await settle();f.element('project-name').value='New project draft';f.element('status').textContent='Current workspace status';
 project.resolve({id:'project'});await oldRequest;assert.equal(f.element('project-name').value,'New project draft');assert.equal(f.element('status').textContent,'Current workspace status');assert.equal(f.element('ci-create').disabled,true);assert.equal(f.element('logout-button').disabled,true);
 key.resolve({token:'synthetic-key'});await newRequest;assert.equal(f.element('ci-create').disabled,false);
});

test('late comparison result cannot replace a changed baseline selection',async()=>{
  const f=await fixture(),comparison=deferred();await f.view('B');f.overrides.set('/v1/compare',()=>comparison.promise);
  const pending=f.element('compare-form').fire('submit');await settle();
  f.element('baseline-run').value='B';await f.element('baseline-run').fire('change');
  comparison.resolve({comparable:true,regressions:[],passRateDelta:0,changes:[],deploymentAllowed:true});await pending;
  assert.equal(f.element('comparison-result').textContent,'기준 실행이 변경됐습니다. 다시 비교하세요.');
});

test('reselecting the same run stops the earlier polling generation',async()=>{
  const f=await fixture(),older=deferred();let request=0;
  f.overrides.set('/v1/runs/A',()=>++request===1?older.promise:execution('A','running'));
  const oldView=f.view('A');await settle();await f.view('B');const newView=f.view('A');await settle();
  older.resolve(execution('A','running'));await oldView;
  assert.equal(request,2);await f.view('B');for(const callback of f.timers.splice(0))callback();await newView;
});

test('an in-flight running response cannot revert a confirmed cancellation',async()=>{
  const f=await fixture(),older=deferred();let request=0;
  f.overrides.set('/v1/runs/A',()=>++request===1?execution('A','running'):older.promise);
  f.overrides.set('/v1/runs/A/cancel',()=>execution('A','cancelled'));
  const viewing=f.view('A');await settle();f.timers.shift()();await settle();
  await f.element('cancel-button').fire('click');older.resolve(execution('A','running'));await viewing;
  assert.equal(f.element('run-state').textContent,'취소됨');assert.equal(f.element('cancel-button').disabled,true);
});

test('older CI history response cannot overwrite a newer refresh',async()=>{
  const f=await fixture(),older=deferred();let request=0;
  const key=name=>({id:name,project_id:'project',name,expires_at:'2099-01-01T00:00:00Z',revoked_at:null});
  f.overrides.set('/v1/ci-credentials?limit=25',()=>++request===1?older.promise:{items:[key('Newer')],nextCursor:null});
  const pending=f.element('ci-refresh').fire('click');await settle();await f.element('ci-refresh').fire('click');
  older.resolve({items:[key('Older')],nextCursor:null});await pending;
  assert.ok(f.element('ci-key-list').textContent.includes('Newer'));assert.ok(!f.element('ci-key-list').textContent.includes('Older'));
});

test('review refresh keeps approval buttons disabled while a submission is pending',async()=>{
  const f=await fixture({manual:true}),submission=deferred();await f.view('B');
  f.overrides.set('/v1/runs/B/reviews',()=>submission.promise);
  f.overrides.set('/v1/runs/B/reviews?limit=25',()=>({items:[],nextCursor:'older'}));
  const pending=f.element('review-form').fire('submit',{submitter:{value:'approved'}});await settle();
  await f.element('review-refresh').fire('click');assert.equal(f.element('review-approve').disabled,true);assert.equal(f.element('review-reject').disabled,true);assert.equal(f.element('review-more').disabled,true);
  submission.resolve({id:'synthetic-review'});await pending;assert.equal(f.element('review-approve').disabled,false);
});

test('older session list response cannot overwrite a newer refresh',async()=>{
 const f=await fixture(),older=deferred();let calls=0;
 const session=name=>({id:name,membershipId:'member',name,role:'viewer',current:false,createdAt:'2026-01-01T00:00:00Z',expiresAt:'2026-01-01T01:00:00Z'});
 f.overrides.set('/v1/sessions?limit=25',()=>++calls===1?older.promise:{items:[session('newer')],nextCursor:null,scope:'organization'});
 const first=f.element('sessions-refresh').fire('click');await settle();await f.element('sessions-refresh').fire('click');older.resolve({items:[session('older')],nextCursor:null,scope:'organization'});await first;
 assert.ok(f.element('session-list').textContent.includes('newer'));assert.ok(!f.element('session-list').textContent.includes('older'));
});
test('session refresh cannot re-enable revocation buttons while a termination is pending',async()=>{
 const f=await fixture(),pending=deferred(),session={id:'synthetic-session',name:'Viewer',role:'viewer',current:false,createdAt:'2026-01-01T00:00:00Z',expiresAt:'2026-01-01T01:00:00Z'};
 f.overrides.set('/v1/sessions?limit=25',()=>({items:[session],nextCursor:null,scope:'organization'}));await f.element('sessions-refresh').fire('click');
 f.overrides.set('/v1/sessions/synthetic-session/revoke',()=>pending.promise);
 const terminating=f.element('session-list').children[0].children.at(-1).fire('click');await settle();await f.element('sessions-refresh').fire('click');
 assert.equal(f.element('session-list').children[0].children.at(-1).disabled,true);assert.equal(f.element('sessions-refresh').disabled,true);
 pending.resolve({id:session.id,revoked:true,current:false});await terminating;assert.equal(f.element('sessions-refresh').disabled,false);assert.equal(f.element('session-list').children[0].children.at(-1).disabled,false);
});


test('obsolete project initialization cannot roll back a newly signed-in workspace',async()=>{
 const f=await fixture(),pending=deferred();let fresh=false;
 const me={role:'viewer',projectId:'fresh-project',organizationName:'Fresh synthetic',name:'Viewer',projects:[{id:'fresh-project',name:'Fresh'}]};
 f.overrides.set('/v1/me',options=>{
  const project=options.headers['X-AgentTrust-Project'];if(project==='pending-project')return pending.promise;
  if(fresh&&project&&project!=='fresh-project')throw Error('Synthetic foreign project rejected');return me;
 });
 f.element('workspace-project').value='pending-project';const old=f.element('workspace-project').fire('change');await settle();
 await f.element('logout-button').fire('click');fresh=true;await f.element('login-form').fire('submit');f.element('status').textContent='Fresh workspace status';
 pending.resolve(me);await old;assert.equal(f.element('workspace-ui').hidden,false);assert.equal(f.element('workspace-project').value,'fresh-project');assert.equal(f.element('status').textContent,'Fresh workspace status');
});
test('obsolete project finally cannot unlock a newer project initialization',async()=>{
 const f=await fixture(),older=deferred(),newer=deferred();const me={role:'admin',projectId:'fresh-project',organizationName:'Synthetic',name:'Admin',projects:[{id:'fresh-project',name:'Fresh'}]};
 f.overrides.set('/v1/me',options=>{const project=options.headers['X-AgentTrust-Project'];if(project==='old-project')return older.promise;if(project==='new-project')return newer.promise;return me;});
 f.element('workspace-project').value='old-project';const old=f.element('workspace-project').fire('change');await settle();await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');
 f.element('workspace-project').value='new-project';const next=f.element('workspace-project').fire('change');await settle();assert.equal(f.element('workspace-project').disabled,true);
 older.resolve(me);await old;const protectedLock=f.element('workspace-project').disabled;
 newer.resolve({...me,projectId:'new-project',projects:[{id:'new-project',name:'New'}]});await next;
 assert.equal(protectedLock,true);assert.equal(f.element('workspace-project').value,'new-project');assert.equal(f.element('workspace-project').disabled,false);
});
test('run navigation follows loaded selection and hides during selection and logout',async()=>{
 const f=await fixture({manual:true});for(const id of ['nav-evidence','nav-review','nav-release'])assert.equal(f.element(id).hidden,true);
 await f.view('B');for(const id of ['nav-evidence','nav-review','nav-release'])assert.equal(f.element(id).hidden,false);
 const pending=deferred();f.runs.A=execution('A','succeeded');f.overrides.set('/v1/runs/A',()=>pending.promise);const selection=f.view('A');await settle();
 for(const id of ['nav-evidence','nav-review','nav-release'])assert.equal(f.element(id).hidden,true);
 pending.resolve(f.runs.A);await selection;assert.equal(f.element('nav-evidence').hidden,false);assert.equal(f.element('nav-release').hidden,false);assert.equal(f.element('nav-review').hidden,true);
 await f.element('logout-button').fire('click');for(const id of ['nav-evidence','nav-review','nav-release'])assert.equal(f.element(id).hidden,true);
});
test('viewer navigation exposes readable manual review without enabling administrator actions',async()=>{
 const f=await fixture({manual:true,initialOverrides:[['/v1/me',()=>({role:'viewer',projectId:'project',organizationName:'Synthetic',name:'Viewer',projects:[{id:'project',name:'Synthetic'}]})]]});
 await f.view('B');assert.equal(f.element('nav-review').hidden,false);assert.equal(f.element('review-form').hidden,true);assert.equal(f.element('review-approve').disabled,true);assert.equal(f.element('review-reject').disabled,true);assert.equal(f.element('nav-projects').hidden,true);
});
test('selecting another run blocks administrator writes to the previously rendered run before the new response arrives',async()=>{
 const f=await fixture({manual:true}),pending=deferred();await f.view('B');let writes=0;
 f.overrides.set('/v1/runs/B/reviews',()=>{writes++;return {};});f.runs.A=execution('A','succeeded',true);f.overrides.set('/v1/runs/A',()=>pending.promise);
 const selection=f.view('A');await settle();const blocked=f.element('review-approve').disabled&&f.element('review-reject').disabled&&f.element('review-panel').hidden;
 await f.element('review-form').fire('submit',{submitter:{value:'approved'}});pending.resolve(f.runs.A);await selection;
 assert.equal(writes,0);assert.equal(blocked,true);assert.equal(f.element('review-panel').hidden,false);assert.equal(f.element('review-approve').disabled,false);
});
test('selecting another run blocks cancellation and download of previously rendered evidence',async()=>{
 const f=await fixture(),pending=deferred();f.view('A');await settle();let writes=0;
 f.overrides.set('/v1/runs/A/cancel',()=>{writes++;return execution('A','cancelled');});f.overrides.set('/v1/runs/B',()=>pending.promise);
 const selection=f.view('B');await settle();const blocked=f.element('cancel-button').disabled&&f.element('download').disabled;
 await f.element('cancel-button').fire('click');await f.element('download').fire('click');pending.resolve(f.runs.B);await selection;
 assert.equal(writes,0);assert.equal(f.downloads.length,0);assert.equal(blocked,true);assert.equal(f.element('download').disabled,false);
});
test('late CI key revocation cannot overwrite the newly signed-in workspace status',async()=>{
 const f=await fixture(),pending=deferred(),key={id:'synthetic-ci-key',name:'Synthetic',project_id:'project',revoked_at:null,expires_at:'2100-01-01T00:00:00Z'};
 f.overrides.set('/v1/ci-credentials?limit=25',()=>({items:[key],nextCursor:null}));await f.element('ci-refresh').fire('click');
 f.overrides.set('/v1/ci-credentials/synthetic-ci-key/revoke',()=>pending.promise);
 const old=f.element('ci-key-list').children[0].children.at(-1).fire('click');await settle();
 await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');f.element('ci-status').textContent='New workspace status';
 pending.resolve({revoked:true});await old;assert.equal(f.element('ci-status').textContent,'New workspace status');
});
test('late current-session revocation cannot log out a newly signed-in workspace',async()=>{
 const f=await fixture(),pending=deferred(),session={id:'old-session',name:'Synthetic',role:'admin',current:true,createdAt:'2026-01-01T00:00:00Z',expiresAt:'2026-01-01T01:00:00Z'};
 f.overrides.set('/v1/sessions?limit=25',()=>({items:[session],nextCursor:null,scope:'organization'}));await f.element('sessions-refresh').fire('click');
 f.overrides.set('/v1/sessions/old-session/revoke',()=>pending.promise);
 const old=f.element('session-list').children[0].children.at(-1).fire('click');await settle();
 await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');assert.equal(f.element('workspace-ui').hidden,false);
 pending.resolve({current:true});await old;assert.equal(f.element('workspace-ui').hidden,false);assert.equal(f.element('login-panel').hidden,true);
});
test('old session revocation cannot overwrite or unlock a newer workspace termination',async()=>{
 const f=await fixture(),older=deferred(),newer=deferred();let id='old-session';
 f.overrides.set('/v1/sessions?limit=25',()=>({items:[{id,name:'Synthetic',role:'admin',current:false,createdAt:'2026-01-01T00:00:00Z',expiresAt:'2026-01-01T01:00:00Z'}],nextCursor:null,scope:'organization'}));await f.element('sessions-refresh').fire('click');
 f.overrides.set('/v1/sessions/old-session/revoke',()=>older.promise);f.overrides.set('/v1/sessions/new-session/revoke',()=>newer.promise);
 const old=f.element('session-list').children[0].children.at(-1).fire('click');await settle();
 await f.element('logout-button').fire('click');id='new-session';await f.element('login-form').fire('submit');
 const next=f.element('session-list').children[0].children.at(-1).fire('click');await settle();assert.equal(f.element('sessions-refresh').disabled,true);
 older.resolve({current:false});await old;assert.equal(f.element('sessions-status').textContent,'');assert.equal(f.element('sessions-refresh').disabled,true);
 newer.resolve({current:false});await next;assert.equal(f.element('sessions-refresh').disabled,false);assert.equal(f.element('sessions-status').textContent,'선택한 세션을 종료했습니다.');
});
const evidenceCase=(index,status='pass')=>({caseId:'case-'+index,input:'Synthetic input '+index,evidence:{output:'Synthetic output',toolEvents:[]},rules:[{ruleId:'rule',required:true,status,reason:'Synthetic reason'}]});
test('evidence pagination bounds rendered cases while retaining whole-run totals and selection',async()=>{
 const f=await fixture();f.runs.B.results=Array.from({length:25},(_,i)=>evidenceCase(i));f.runs.B.summary={cases:25,pass:25,fail:0,inconclusive:0};await f.view('B');
 assert.equal(f.element('results').children.length,10);assert.match(f.element('evidence-count').textContent,/1–10/);assert.equal(f.element('evidence-previous').disabled,true);assert.equal(f.element('case-count').textContent,'25');
 await f.element('evidence-next').fire('click');assert.equal(f.element('results').children[0].children[0].textContent,'case-10');
 await f.element('evidence-next').fire('click');assert.equal(f.element('results').children.length,5);assert.equal(f.element('evidence-next').disabled,true);assert.equal(f.element('allowed').textContent,'허용');
 await f.element('evidence-previous').fire('click');assert.match(f.element('evidence-count').textContent,/11–20/);
 await f.view('B');assert.match(f.element('evidence-count').textContent,/11–20/);
 f.runs.A=execution('A');f.runs.A.results=[evidenceCase(99)];await f.view('A');assert.match(f.element('evidence-count').textContent,/1–1/);assert.equal(f.element('results').children[0].children[0].textContent,'case-99');
});
test('evidence search and rule filters preserve failed and inconclusive evidence without changing the gate',async()=>{
 const f=await fixture();f.runs.B.results=[evidenceCase(1),evidenceCase(2,'fail'),evidenceCase(3,'inconclusive'),{...evidenceCase(4),error:'Synthetic adapter failure',rules:[]}];await f.view('B');
 f.element('evidence-filter').value='fail';await f.element('evidence-filter').fire('change');assert.equal(f.element('results').children.length,1);assert.match(f.element('results').textContent,/case-2/);assert.match(f.element('results').textContent,/FAIL/);
 f.element('evidence-filter').value='inconclusive';await f.element('evidence-filter').fire('change');assert.equal(f.element('results').children.length,2);assert.match(f.element('results').textContent,/Synthetic adapter failure/);
 f.element('evidence-filter').value='';f.element('evidence-search').value='INPUT 1';await f.element('evidence-search').fire('input');assert.equal(f.element('results').children.length,1);assert.match(f.element('results').textContent,/case-1/);assert.equal(f.element('allowed').textContent,'허용');
 f.element('evidence-search').value='no match';await f.element('evidence-search').fire('input');assert.match(f.element('results').textContent,/검색·필터에 맞는 사례가 없습니다/);assert.equal(f.element('evidence-next').disabled,true);
 await f.element('logout-button').fire('click');assert.equal(f.element('evidence-search').disabled,true);assert.equal(f.element('evidence-filter').disabled,true);assert.equal(f.element('evidence-search').value,'');assert.equal(f.element('evidence-count').textContent,'실행을 선택하면 사례를 찾아볼 수 있습니다.');
});


test('filtered paginated evidence downloads the complete immutable run JSON',async()=>{
 const f=await fixture();f.runs.B.results=Array.from({length:25},(_,i)=>evidenceCase(i,i===24?'fail':'pass'));await f.view('B');
 f.element('evidence-filter').value='fail';await f.element('evidence-filter').fire('change');assert.equal(f.element('results').children.length,1);
 await f.element('download').fire('click');assert.equal(f.downloads.length,1);const exported=JSON.parse(await f.downloads[0].text());assert.equal(exported.id,'B');assert.equal(exported.results.length,25);assert.equal(exported.results[24].rules[0].status,'fail');assert.equal(exported.snapshotHash,'synthetic-B');
});


const reviewEntry=comment=>({id:comment,actorId:'synthetic-actor',createdAt:'2026-01-01T00:00:00Z',decision:'rejected',comment});
test('review pages append in order and a newer refresh excludes an older pending page',async()=>{
 const f=await fixture({manual:true}),older=deferred();let refresh=0;
 f.overrides.set('/v1/runs/B/reviews?limit=25',()=>({items:[reviewEntry(++refresh===1?'first':'refreshed')],nextCursor:'older'}));await f.view('B');assert.equal(f.element('review-more').disabled,false);assert.match(f.element('review-history-status').textContent,/1개 표시/);
 f.overrides.set('/v1/runs/B/reviews?limit=25&cursor=older',()=>({items:[reviewEntry('second')],nextCursor:null}));await f.element('review-more').fire('click');assert.match(f.element('review-list').textContent,/first/);assert.match(f.element('review-list').textContent,/second/);assert.equal(f.element('review-more').disabled,true);assert.match(f.element('review-history-status').textContent,/2개 표시.*마지막 기록/);
 await f.element('review-refresh').fire('click');f.overrides.set('/v1/runs/B/reviews?limit=25&cursor=older',()=>older.promise);const pending=f.element('review-more').fire('click');await settle();await f.element('review-refresh').fire('click');older.resolve({items:[reviewEntry('obsolete')],nextCursor:null});await pending;
 assert.match(f.element('review-list').textContent,/refreshed/);assert.ok(!f.element('review-list').textContent.includes('obsolete'));assert.equal(f.element('review-more').disabled,false);
});
test('a pending review page cannot append after another run is selected',async()=>{
 const f=await fixture({manual:true}),older=deferred();f.runs.A=execution('A','succeeded',true);
 f.overrides.set('/v1/runs/B/reviews?limit=25',()=>({items:[reviewEntry('B opinion')],nextCursor:'older'}));await f.view('B');f.overrides.set('/v1/runs/B/reviews?limit=25&cursor=older',()=>older.promise);
 const pending=f.element('review-more').fire('click');await settle();await f.view('A');older.resolve({items:[reviewEntry('obsolete B opinion')],nextCursor:null});await pending;
 assert.ok(!f.element('review-list').textContent.includes('B opinion'));assert.equal(f.element('review-more').disabled,true);
});


test('a review submission failure cannot replace the status of a newly selected run',async()=>{
 const f=await fixture({manual:true}),submission=deferred();f.runs.A=execution('A','succeeded',true);await f.view('B');f.overrides.set('/v1/runs/B/reviews',()=>submission.promise);
 const pending=f.element('review-form').fire('submit',{submitter:{value:'rejected'}});await settle();await f.view('A');f.element('status').textContent='Current run status';submission.resolve(Promise.reject(new Error('Obsolete review failure')));await pending;
 assert.equal(f.element('status').textContent,'Current run status');assert.ok(f.element('snapshot').textContent.includes('실행 A'));
});


test('initial hydration hides interactive workspace and registers forms before the first awaited read',async()=>{
 const first=deferred(),f=await fixture({initialOverrides:[['/v1/ci-credentials?limit=25',()=>first.promise]],waitForInitialization:false});await settle();
 assert.equal(f.element('workspace-ui').hidden,true);assert.equal(f.element('loading-panel').hidden,false);assert.equal(f.element('login-panel').hidden,true);assert.equal(f.element('login-button').disabled,true);
 assert.equal(f.element('history-filter-form').handlers.submit.length,1);assert.equal(f.element('project-form').handlers.submit.length,1);assert.equal(f.element('review-form').handlers.submit.length,1);
 let prevented=0;await f.element('history-filter-form').fire('submit',{preventDefault:()=>prevented++});assert.equal(prevented,1);
 first.resolve({items:[],nextCursor:null});await f.initialized;assert.equal(f.element('workspace-ui').hidden,false);assert.equal(f.element('loading-panel').hidden,true);assert.equal(f.element('login-panel').hidden,true);
});
test('failed initial hydration returns to a usable login without exposing partial workspace',async()=>{
 const f=await fixture({initialOverrides:[['/v1/ci-credentials?limit=25',()=>{throw new Error('Synthetic initialization read failed');}]]});
 assert.equal(f.element('workspace-ui').hidden,true);assert.equal(f.element('loading-panel').hidden,true);assert.equal(f.element('login-panel').hidden,false);assert.equal(f.element('login-button').disabled,false);assert.match(f.element('login-status').textContent,/서버 응답을 읽지 못했습니다/);assert.ok(!f.element('login-status').textContent.includes('Synthetic initialization read failed'));
});
test('data loading failure after login cannot leave the loading panel stuck',async()=>{
 const f=await fixture();await f.element('logout-button').fire('click');f.overrides.set('/v1/ci-credentials?limit=25',()=>{throw new Error('Synthetic post-login read failed');});f.element('access-key').value='synthetic-key';await f.element('login-form').fire('submit');
 assert.equal(f.element('workspace-ui').hidden,true);assert.equal(f.element('loading-panel').hidden,true);assert.equal(f.element('login-panel').hidden,false);assert.equal(f.element('login-button').disabled,false);assert.equal(f.element('access-key').value,'');assert.match(f.element('login-status').textContent,/서버 응답을 읽지 못했습니다/);assert.ok(!f.element('login-status').textContent.includes('Synthetic post-login read failed'));
});

const releaseResult=(allowed=true,baselineRunId,extra={})=>{const result={runId:'B',decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['A required rule failed.'],...extra};return {...result,artifact:{checkedAt:'2026-01-01T00:00:00Z',receiptId:'synthetic-receipt',request:{candidateRunId:'B',...(baselineRunId?{baselineRunId}:{})},result:structuredClone(result),evidence:{candidate:{runId:'B'},...(baselineRunId?{baseline:{runId:baselineRunId}}:{})}}};};
test('completed evaluations without manual approval expose a version-bound final gate check',async()=>{
 const f=await fixture();await f.view('B');assert.equal(f.element('review-panel').hidden,true);assert.equal(f.element('release-check-panel').hidden,false);assert.equal(f.element('manual-gate-check').disabled,false);
 let input;f.overrides.set('/v1/release-gate',options=>{input=JSON.parse(options.body);return releaseResult();});await f.element('manual-gate-check').fire('click');
 assert.deepEqual(input,{candidateRunId:'B',agentVersionId:'agent',datasetVersionId:'dataset',policyVersionId:'policy'});assert.match(f.element('manual-gate-output').textContent,/확인 시점의 최종 게이트: 통과/);assert.match(f.element('manual-gate-output').textContent,/synthetic-receipt/);
});
test('running evaluations cannot request the final gate and blocked results remain blocked',async()=>{
 const f=await fixture();let requests=0;f.overrides.set('/v1/release-gate',()=>{requests++;return releaseResult(false);});const pending=f.view('A');await settle();assert.equal(f.element('manual-gate-check').disabled,true);await f.element('manual-gate-check').fire('click');assert.equal(requests,0);
 await f.view('B');for(const callback of f.timers.splice(0))callback();await pending;await f.element('manual-gate-check').fire('click');assert.equal(requests,1);assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 차단/);
});
test('a late final gate cannot survive switching away and reselecting the same run',async()=>{
 const f=await fixture(),older=deferred();f.runs.A=execution('A');await f.view('B');f.overrides.set('/v1/release-gate',()=>older.promise);const pending=f.element('manual-gate-check').fire('click');await settle();await f.view('A');await f.view('B');older.resolve(releaseResult());await pending;
 assert.equal(f.element('manual-gate-output').textContent,'최종 게이트를 아직 확인하지 않았습니다.');assert.equal(f.element('manual-gate-check').disabled,false);
});
test('duplicate final gate clicks are suppressed and failed checks can be retried',async()=>{
 const f=await fixture(),pending=deferred();await f.view('B');let requests=0;f.overrides.set('/v1/release-gate',()=>{requests++;return pending.promise;});const checking=f.element('manual-gate-check').fire('click');await settle();await f.element('manual-gate-check').fire('click');assert.equal(requests,1);
 pending.resolve(Promise.reject(new Error('Synthetic gate failure')));await checking;assert.match(f.element('manual-gate-output').textContent,/확인 실패/);assert.equal(f.element('manual-gate-check').disabled,false);f.overrides.set('/v1/release-gate',()=>releaseResult());await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 통과/);
});
test('review refresh invalidates an in-flight final gate even when the run stays selected',async()=>{
 const f=await fixture({manual:true}),older=deferred();await f.view('B');f.overrides.set('/v1/release-gate',()=>older.promise);const pending=f.element('manual-gate-check').fire('click');await settle();await f.element('review-refresh').fire('click');older.resolve(releaseResult());await pending;
 assert.match(f.element('manual-gate-output').textContent,/다시 확인하세요/);assert.equal(f.element('manual-gate-check').disabled,false);
});

test('next actions guide running, blocked and inconclusive evaluations without changing their gates',async()=>{
 const f=await fixture();const pending=f.view('A');await settle();assert.match(f.element('next-action-title').textContent,/완료를 기다리세요/);
 f.runs.B.gate={decision:'block',deploymentAllowed:false};await f.view('B');assert.match(f.element('next-action-title').textContent,/실패한 근거/);assert.equal(f.element('next-action-link').href,'#evidence');assert.equal(f.runs.B.gate.deploymentAllowed,false);
 f.runs.B.gate={decision:'inconclusive',deploymentAllowed:false};await f.view('B');assert.match(f.element('next-action-detail').textContent,/통과가 아닙니다/);for(const callback of f.timers.splice(0))callback();await pending;
});
test('passing evaluation guides final checking and invalidation removes prior release guidance',async()=>{
 const f=await fixture();await f.view('B');assert.equal(f.element('next-action-link').href,'#release-check-panel');f.overrides.set('/v1/release-gate',()=>releaseResult());await f.element('manual-gate-check').fire('click');assert.equal(f.element('next-action-link').href,'#receipts-panel');assert.match(f.element('next-action-detail').textContent,/새 최종 게이트/);
 await f.view('B');assert.equal(f.element('next-action-link').href,'#release-check-panel');assert.ok(!f.element('next-action-title').textContent.includes('기록을 보관'));
});
test('viewer approval guidance respects role and expired results require reevaluation',async()=>{
 const f=await fixture({manual:true,initialOverrides:[['/v1/me',()=>({role:'viewer',projectId:'project',name:'Viewer',organizationName:'Synthetic',projects:[{id:'project',name:'Synthetic'}]})]]});assert.equal(f.element('next-action-link').href,'#history');await f.view('B');
 f.overrides.set('/v1/release-gate',()=>releaseResult(false,undefined,{manualApproval:{status:'expired'}}));await f.element('manual-gate-check').fire('click');assert.match(f.element('next-action-title').textContent,/승인을 다시 요청/);assert.match(f.element('next-action-detail').textContent,/작성할 수 없습니다/);assert.equal(f.element('next-action-link').href,'#review-panel');
 f.overrides.set('/v1/release-gate',()=>releaseResult(false,undefined,{reasons:['Result is missing, stale or future-dated.'],manualApproval:{status:'approved'}}));await f.element('manual-gate-check').fire('click');assert.equal(f.element('next-action-link').href,'#evaluation');assert.match(f.element('manual-gate-output').textContent,/유효 시간이 지났/);
});
test('failed final check gives retry guidance and late success cannot overwrite it after refresh',async()=>{
 const f=await fixture({manual:true});await f.view('B');f.overrides.set('/v1/release-gate',()=>{throw Error('Synthetic check failed');});await f.element('manual-gate-check').fire('click');assert.match(f.element('next-action-title').textContent,/다시 요청/);assert.match(f.element('next-action-detail').textContent,/성공 판정으로 사용할 수 없습니다/);
 const older=deferred();f.overrides.set('/v1/release-gate',()=>older.promise);const pending=f.element('manual-gate-check').fire('click');await settle();await f.element('review-refresh').fire('click');older.resolve(releaseResult());await pending;assert.equal(f.element('next-action-link').href,'#review-panel');assert.ok(!f.element('next-action-title').textContent.includes('기록을 보관'));
});

const lookupId='00000000-0000-0000-0000-000000000123';
test('direct run lookup accepts normalized UUID and reuses the authorized response',async()=>{
 const f=await fixture();let reads=0;f.overrides.set('/v1/runs/'+lookupId,()=>{reads++;return execution(lookupId);});f.element('run-lookup-id').value=' '+lookupId.toUpperCase()+' ';f.element('history-state').value='failed';await f.element('run-lookup-form').fire('submit');
 assert.equal(reads,1);assert.match(f.element('snapshot').textContent,new RegExp(lookupId));assert.match(f.element('run-lookup-status').textContent,/불러왔습니다/);assert.equal(f.element('history-state').value,'failed');assert.equal(f.element('run-lookup-button').disabled,false);
});
test('invalid and inaccessible direct IDs preserve the selected run without exposing errors',async()=>{
 const f=await fixture();await f.view('B');let reads=0;f.overrides.set('/v1/runs/'+lookupId,()=>{reads++;throw Error('private-canary');});f.element('run-lookup-id').value='../private';await f.element('run-lookup-form').fire('submit');assert.equal(reads,0);assert.match(f.element('run-lookup-status').textContent,/UUID/);
 f.element('run-lookup-id').value=lookupId;await f.element('run-lookup-form').fire('submit');assert.equal(reads,1);assert.match(f.element('snapshot').textContent,/실행 B/);assert.ok(!f.element('run-lookup-status').textContent.includes('private-canary'));assert.equal(f.element('run-lookup-button').disabled,false);
});
test('a delayed direct lookup cannot replace a run selected from history and suppresses duplicates',async()=>{
 const f=await fixture(),older=deferred();let reads=0;f.overrides.set('/v1/runs/'+lookupId,()=>{reads++;return older.promise;});f.element('run-lookup-id').value=lookupId;const pending=f.element('run-lookup-form').fire('submit');await settle();await f.element('run-lookup-form').fire('submit');assert.equal(reads,1);await f.view('B');older.resolve(execution(lookupId));await pending;assert.match(f.element('snapshot').textContent,/실행 B/);assert.equal(f.element('run-lookup-button').disabled,false);
});
test('logout clears direct lookup state and an older response cannot restore it',async()=>{
 const f=await fixture(),older=deferred();f.overrides.set('/v1/runs/'+lookupId,()=>older.promise);f.element('run-lookup-id').value=lookupId;const pending=f.element('run-lookup-form').fire('submit');await settle();await f.element('logout-button').fire('click');older.resolve(execution(lookupId));await pending;assert.equal(f.element('run-lookup-id').value,'');assert.equal(f.element('run-lookup-status').textContent,'');assert.equal(f.element('release-check-panel').hidden,true);
});

function signedUiReceipt(runId='B',allowed=true){
 const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
 const artifact={schemaVersion:1,receiptId:'00000000-0000-0000-0000-000000000456',checkedAt:'2026-01-01T00:00:00Z',request:{candidateRunId:runId},result:{runId,decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['A required rule failed.']},evidence:{candidate:{runId,snapshotHash:'synthetic',resultHash:'synthetic'}}};
 return {report:{...releaseResult(allowed),runId,artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)},publicKey:signer.publicMetadata().publicKey};
}
test('current signed gate exports the exact artifact hash and signature for offline verification',async()=>{
 const f=await fixture(),signed=signedUiReceipt();await f.view('B');f.overrides.set('/v1/release-gate',()=>signed.report);f.overrides.set('/v1/release-receipts?limit=25',()=>{throw Error('Synthetic list refresh failure');});await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 통과/);assert.equal(f.element('current-receipt-download').disabled,false);await f.element('current-receipt-download').fire('click');
 const downloaded=JSON.parse(await f.downloads[0].text());assert.deepEqual(downloaded,{artifact:signed.report.artifact,artifactHash:signed.report.artifactHash,signature:signed.report.signature});assert.equal(verifyReceipt(downloaded,signed.publicKey).signatureVerified,true);
});
test('blocked gate records can be downloaded without changing deployment permission',async()=>{
 const f=await fixture(),signed=signedUiReceipt('B',false);await f.view('B');f.overrides.set('/v1/release-gate',()=>signed.report);await f.element('manual-gate-check').fire('click');await f.element('current-receipt-download').fire('click');const downloaded=JSON.parse(await f.downloads[0].text());assert.equal(downloaded.artifact.result.deploymentAllowed,false);assert.equal(verifyReceipt(downloaded,signed.publicKey).decision,'block');
});
test('rechecking, refreshing review and selecting another run invalidate the downloadable current receipt',async()=>{
 const f=await fixture({manual:true}),signed=signedUiReceipt();await f.view('B');f.overrides.set('/v1/release-gate',()=>signed.report);await f.element('manual-gate-check').fire('click');await f.element('review-refresh').fire('click');assert.equal(f.element('current-receipt-download').disabled,true);await f.element('current-receipt-download').fire('click');assert.equal(f.downloads.length,0);
 await f.element('manual-gate-check').fire('click');const older=deferred();f.overrides.set('/v1/release-gate',()=>older.promise);const pending=f.element('manual-gate-check').fire('click');await settle();assert.equal(f.element('current-receipt-download').disabled,true);const viewing=f.view('A');await settle();older.resolve(signed.report);await pending;assert.equal(f.element('current-receipt-download').disabled,true);await f.view('B');for(const callback of f.timers.splice(0))callback();await viewing;
});
test('a receipt bound to another execution cannot enable current-record download',async()=>{
 const f=await fixture(),valid=signedUiReceipt();await f.view('B');
 const responses=[signedUiReceipt('other-run').report,{...valid.report,runId:'other-run'},{...valid.report,artifact:{...valid.report.artifact,request:{candidateRunId:'other-run'}}},{...valid.report,artifact:{...valid.report.artifact,evidence:{candidate:{runId:'other-run'}}}},{...valid.report,artifact:undefined},...[false,0,''].map(baselineRunId=>({...valid.report,artifact:{...valid.report.artifact,request:{candidateRunId:'B',baselineRunId}}}))];
 for(const report of responses){f.overrides.set('/v1/release-gate',()=>report);await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/확인 실패/);assert.ok(!f.element('manual-gate-output').textContent.includes('최종 게이트: 통과'));assert.equal(f.element('current-receipt-download').disabled,true);await f.element('current-receipt-download').fire('click');assert.equal(f.downloads.length,0);}
 f.overrides.set('/v1/release-gate',()=>valid.report);await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 통과/);assert.equal(f.element('current-receipt-download').disabled,false);
});

const gateBaseline='00000000-0000-0000-0000-000000000789';
async function enableBaseline(f,id=gateBaseline){f.element('gate-baseline-enabled').checked=true;await f.element('gate-baseline-enabled').fire('change');f.element('gate-baseline-id').value=id;await f.element('gate-baseline-id').fire('input');}
test('optional baseline is normalized and regression blocks final release',async()=>{
 const f=await fixture();await f.view('B');assert.equal(f.element('gate-comparison-inputs').hidden,true);await enableBaseline(f,' '+gateBaseline.toUpperCase()+' ');assert.equal(f.element('gate-comparison-inputs').hidden,false);let input;
 f.overrides.set('/v1/release-gate',options=>{input=JSON.parse(options.body);return releaseResult(false,gateBaseline,{comparison:{comparable:true,deploymentAllowed:false},reasons:['Baseline comparison is incomplete or regressed.']});});await f.element('manual-gate-check').fire('click');
 assert.equal(input.baselineRunId,gateBaseline);assert.match(f.element('manual-gate-output').textContent,/회귀 비교: 차단/);assert.match(f.element('manual-gate-output').textContent,new RegExp(gateBaseline));assert.match(f.element('next-action-title').textContent,/차단 사유/);
});
test('invalid and identical baseline IDs make no final gate request',async()=>{
 const f=await fixture();await f.view('B');let requests=0;f.overrides.set('/v1/release-gate',()=>{requests++;return releaseResult();});await enableBaseline(f,'invalid');await f.element('manual-gate-check').fire('click');assert.equal(requests,0);
 f.runs.B.id=gateBaseline;f.overrides.set('/v1/runs/'+gateBaseline,()=>f.runs.B);f.element('run-lookup-id').value=gateBaseline;await f.element('run-lookup-form').fire('submit');await enableBaseline(f);await f.element('manual-gate-check').fire('click');assert.equal(requests,0);
});
test('changing baseline invalidates receipt and late response even after restoring the ID',async()=>{
 const f=await fixture(),older=deferred();await f.view('B');await enableBaseline(f);f.overrides.set('/v1/release-gate',()=>older.promise);const pending=f.element('manual-gate-check').fire('click');await settle();
 f.element('gate-baseline-id').value=lookupId;await f.element('gate-baseline-id').fire('input');f.element('gate-baseline-id').value=gateBaseline;await f.element('gate-baseline-id').fire('input');older.resolve(releaseResult());await pending;
 assert.match(f.element('manual-gate-output').textContent,/다시 확인/);assert.equal(f.element('current-receipt-download').disabled,true);assert.equal(f.element('manual-gate-check').disabled,false);
 f.element('gate-baseline-enabled').checked=false;await f.element('gate-baseline-enabled').fire('change');assert.equal(f.element('gate-comparison-inputs').hidden,true);let input;f.overrides.set('/v1/release-gate',options=>{input=JSON.parse(options.body);return releaseResult();});await f.element('manual-gate-check').fire('click');assert.ok(!('baselineRunId' in input));await f.element('logout-button').fire('click');assert.equal(f.element('gate-baseline-id').value,'');assert.equal(f.element('gate-baseline-enabled').checked,false);assert.equal(f.element('gate-comparison-inputs').hidden,true);
});
test('baseline-bound signed receipt exports unchanged and mismatched baseline cannot enable download',async()=>{
 const f=await fixture();await f.view('B');await enableBaseline(f);const signed=signedUiReceipt(),artifact=signed.report.artifact;artifact.request.baselineRunId=gateBaseline;artifact.evidence.baseline={runId:gateBaseline};
 const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));signed.report.artifactHash=hash(artifact);signed.report.signature=signer.sign(artifact);signed.report.comparison={comparable:true,deploymentAllowed:true};artifact.result.comparison=structuredClone(signed.report.comparison);signed.report.artifactHash=hash(artifact);signed.report.signature=signer.sign(artifact);
 f.overrides.set('/v1/release-gate',()=>signed.report);await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/회귀 비교: 통과/);await f.element('current-receipt-download').fire('click');const downloaded=JSON.parse(await f.downloads[0].text());assert.deepEqual(downloaded.artifact,artifact);assert.equal(verifyReceipt(downloaded,signer.publicMetadata().publicKey).signatureVerified,true);
 await enableBaseline(f,lookupId);assert.equal(f.element('current-receipt-download').disabled,true);await f.element('manual-gate-check').fire('click');assert.equal(f.element('current-receipt-download').disabled,true);assert.match(f.element('manual-gate-output').textContent,/확인 실패/);assert.ok(!f.element('manual-gate-output').textContent.includes('최종 게이트: 통과'));
});

test('recent baseline choices exclude candidate and incomplete runs and preserve manually entered IDs',async()=>{
 const f=await fixture();await f.view('B');assert.equal(f.element('gate-baseline-recent').children.length,1);assert.equal(f.element('gate-baseline-recent').disabled,true);
 f.runs.A=execution('a');await f.element('history-filter-form').fire('submit');await enableBaseline(f,gateBaseline);assert.equal(f.element('gate-baseline-recent').disabled,false);assert.deepEqual(f.element('gate-baseline-recent').children.map(x=>x.value),['','a']);assert.equal(f.element('gate-baseline-id').value,gateBaseline);
 f.element('gate-baseline-recent').value='a';await f.element('gate-baseline-recent').fire('change');assert.equal(f.element('gate-baseline-id').value,'a');assert.match(f.element('manual-gate-output').textContent,/다시 확인/);await f.element('history-filter-form').fire('submit');assert.equal(f.element('gate-baseline-id').value,'a');assert.equal(f.element('gate-baseline-recent').value,'a');
});
test('recent baseline selection revokes a prior receipt and workspace clearing removes cached choices',async()=>{
 const f=await fixture();f.runs.A=execution('a');await f.element('history-filter-form').fire('submit');await f.view('B');f.overrides.set('/v1/release-gate',()=>signedUiReceipt().report);await f.element('manual-gate-check').fire('click');assert.equal(f.element('current-receipt-download').disabled,false);
 await enableBaseline(f);f.element('gate-baseline-recent').value='a';await f.element('gate-baseline-recent').fire('change');assert.equal(f.element('current-receipt-download').disabled,true);await f.element('logout-button').fire('click');assert.equal(f.element('gate-baseline-recent').children.length,1);assert.equal(f.element('gate-baseline-recent').disabled,true);
});

test('manual approval blocks release independently from a passing baseline comparison',async()=>{
 const f=await fixture({manual:true});await f.view('B');await enableBaseline(f);f.overrides.set('/v1/release-gate',()=>releaseResult(false,gateBaseline,{manualApproval:{status:'missing'},comparison:{comparable:true,evaluationPassed:true,deploymentAllowed:false,requiresManualApproval:true,changes:[],regressions:[]}}));await f.element('manual-gate-check').fire('click');
 assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 차단/);assert.match(f.element('manual-gate-output').textContent,/회귀 비교: 통과/);assert.match(f.element('manual-gate-output').textContent,/관리자 승인은 별도로/);assert.equal(f.element('next-action-link').href,'#review-panel');
});
test('regression details render as bounded text with complete counts retained',async()=>{
 const f=await fixture();await f.view('B');await enableBaseline(f);const regressions=Array.from({length:12},(_,i)=>({caseId:'<script>'+i,ruleId:'rule-'+i,before:'pass',after:'fail'}));f.overrides.set('/v1/release-gate',()=>releaseResult(false,gateBaseline,{comparison:{comparable:true,deploymentAllowed:false,changes:regressions,regressions}}));await f.element('manual-gate-check').fire('click');
 const output=f.element('manual-gate-output').textContent;assert.match(output,/변경 규칙 12개 · 회귀 12개/);assert.match(output,/<script>0/);assert.match(output,/rule-9/);assert.ok(!output.includes('rule-10'));assert.match(output,/나머지 회귀 2개/);assert.equal(f.element('manual-gate-output').children.length,0);
});
test('incomplete comparison never displays a pass despite permissive flags',async()=>{
 const f=await fixture();await f.view('B');await enableBaseline(f);f.overrides.set('/v1/release-gate',()=>releaseResult(false,gateBaseline,{comparison:{comparable:false,evaluationPassed:true,deploymentAllowed:true}}));await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/회귀 비교: 미완료/);assert.ok(!f.element('manual-gate-output').textContent.includes('회귀 비교: 통과'));
});

async function regressionFixture(){
 const f=await fixture();f.runs.B.results=[evidenceCase(1,'fail'),evidenceCase(10,'fail')];await f.view('B');await enableBaseline(f);f.overrides.set('/v1/release-gate',()=>releaseResult(false,gateBaseline,{comparison:{comparable:true,deploymentAllowed:false,regressions:[{caseId:'case-1',ruleId:'rule',before:'pass',after:'fail'}]}}));await f.element('manual-gate-check').fire('click');return f;
}
test('regression navigation selects the exact case without changing gate or complete download',async()=>{
 const f=await regressionFixture();f.element('evidence-filter').value='pass';await f.element('evidence-filter').fire('change');await f.element('gate-regression-links').children[0].fire('click');assert.equal(f.element('results').children.length,1);assert.match(f.element('results').textContent,/case-1/);assert.ok(!f.element('results').textContent.includes('case-10'));assert.match(f.element('evidence-focus').textContent,/case-1/);assert.equal(f.element('evidence-filter').value,'');await f.element('download').fire('click');assert.equal(JSON.parse(await f.downloads[0].text()).results.length,2);await f.element('evidence-focus-clear').fire('click');assert.equal(f.element('results').children.length,2);
});
test('an obsolete regression link cannot restore focus after baseline change or run reselection',async()=>{
 const f=await regressionFixture(),link=f.element('gate-regression-links').children[0];await f.element('gate-baseline-id').fire('input');assert.equal(f.element('gate-regression-links').children.length,0);await link.fire('click');assert.equal(f.element('evidence-focus').textContent,'');await f.element('manual-gate-check').fire('click');await f.element('gate-regression-links').children[0].fire('click');await f.view('B');assert.match(f.element('evidence-focus').textContent,/case-1/);await f.element('logout-button').fire('click');assert.equal(f.element('evidence-focus').textContent,'');
});
test('editing ordinary evidence filters clears exact regression focus',async()=>{
 const f=await regressionFixture();await f.element('gate-regression-links').children[0].fire('click');f.element('evidence-search').value='case-10';await f.element('evidence-search').fire('input');assert.equal(f.element('evidence-focus').textContent,'');assert.equal(f.element('evidence-focus-clear').hidden,true);assert.match(f.element('results').textContent,/case-10/);
});


test('malformed or contradictory final gate responses cannot show pass or enable receipt export',async()=>{
 const f=await fixture();await f.view('B');
 const signed=signedUiReceipt();
 const responses=[{...signed.report,deploymentAllowed:'false'},{...signed.report,deploymentAllowed:1},{...signed.report,decision:'block'},{...signed.report,decision:'inconclusive'},{...signed.report,reasons:['Synthetic blocking reason']},{...signed.report,reasons:null},{...signed.report,reasons:[9]},null];
 for(const response of responses){
  f.overrides.set('/v1/release-gate',()=>response);await f.element('manual-gate-check').fire('click');
  assert.match(f.element('manual-gate-output').textContent,/확인 실패/);assert.ok(!f.element('manual-gate-output').textContent.includes('최종 게이트: 통과'));
  assert.equal(f.element('current-receipt-download').disabled,true);assert.equal(f.element('manual-gate-check').disabled,false);assert.equal(f.element('next-action-link').href,'#release-check-panel');
  await f.element('current-receipt-download').fire('click');assert.equal(f.downloads.length,0);
 }
 f.overrides.set('/v1/release-gate',()=>signed.report);await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 통과/);assert.equal(f.element('current-receipt-download').disabled,false);
});


test('obsolete review completion cannot clear a new workspace review lock or status',async()=>{
 const f=await fixture({manual:true}),older=deferred(),newer=deferred();let calls=0;
 await f.view('B');f.overrides.set('/v1/runs/B/reviews',()=>++calls===1?older.promise:newer.promise);
 const oldSubmission=f.element('review-form').fire('submit',{submitter:{value:'approved'}});await settle();
 await f.element('logout-button').fire('click');await f.element('login-form').fire('submit');await f.view('B');
 assert.equal(f.element('review-approve').disabled,false);
 const newSubmission=f.element('review-form').fire('submit',{submitter:{value:'rejected'}});await settle();assert.equal(calls,2);
 const currentText=f.element('manual-gate-output').textContent;older.resolve({});await oldSubmission;
 assert.equal(f.element('manual-gate-output').textContent,currentText);assert.equal(f.element('review-approve').disabled,true);assert.equal(f.element('review-reject').disabled,true);assert.equal(f.element('manual-gate-check').disabled,true);
 await f.element('review-form').fire('submit',{submitter:{value:'approved'}});assert.equal(calls,2);
 newer.resolve({});await newSubmission;assert.equal(f.element('review-approve').disabled,false);assert.equal(f.element('manual-gate-check').disabled,false);
});


test('review success from an earlier selection preserves a newly drafted comment for the same run',async()=>{
 const f=await fixture({manual:true}),reply=deferred();await f.view('B');f.overrides.set('/v1/runs/B/reviews',()=>reply.promise);
 f.element('review-comment').value='Submitted synthetic opinion';const pending=f.element('review-form').fire('submit',{submitter:{value:'approved'}});await settle();
 await f.view('B');f.element('review-comment').value='New synthetic draft';f.element('status').textContent='Current selection status';reply.resolve({});await pending;
 assert.equal(f.element('review-comment').value,'New synthetic draft');assert.equal(f.element('status').textContent,'Current selection status');assert.equal(f.element('review-approve').disabled,false);
});


test('final gate timeout releases its button without granting permission and can be retried',async()=>{
 const controllers=[],f=await fixture({timeoutSignal:ms=>{assert.equal(ms,15000);const c=new AbortController();controllers.push(c);return c.signal;}});await f.view('B');
 f.overrides.set('/v1/release-gate',options=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})));
 const pending=f.element('manual-gate-check').fire('click');await settle();assert.equal(f.element('manual-gate-check').disabled,true);
 controllers.at(-1).abort(new DOMException('Synthetic deadline','TimeoutError'));await pending;
 assert.match(f.element('manual-gate-output').textContent,/시간이 초과/);assert.match(f.element('manual-gate-output').textContent,/처리됐을 수/);assert.equal(f.element('manual-gate-check').disabled,false);assert.equal(f.element('current-receipt-download').disabled,true);assert.equal(f.element('next-action-link').href,'#release-check-panel');
 f.overrides.set('/v1/release-gate',()=>signedUiReceipt().report);await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 통과/);
});

test('malformed HTTP JSON cannot expose response fragments in the final gate error',async()=>{
 const f=await fixture();await f.view('B');const canary='syn_key';f.overrides.set('/v1/release-gate',()=>new Response(canary));
 await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/확인 실패/);assert.ok(!f.element('manual-gate-output').textContent.includes(canary));assert.equal(f.element('current-receipt-download').disabled,true);assert.equal(f.element('manual-gate-check').disabled,false);
});

test('invalid UTF-8 and excessive HTTP evidence cannot display a passing final gate',async()=>{
 const f=await fixture();await f.view('B');const signed=signedUiReceipt(),json=JSON.stringify(signed.report);
 const damaged=Buffer.concat([Buffer.from(json.slice(0,-1)+',"ignored":"'),Buffer.from([255]),Buffer.from('"}')]);
 for(const body of [damaged,JSON.stringify({...signed.report,ignored:'x'.repeat(8*1024*1024)})]){
  f.overrides.set('/v1/release-gate',()=>new Response(body));await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/확인 실패/);assert.ok(!f.element('manual-gate-output').textContent.includes('최종 게이트: 통과'));assert.equal(f.element('current-receipt-download').disabled,true);assert.equal(f.element('manual-gate-check').disabled,false);
 }
 f.overrides.set('/v1/release-gate',()=>signed.report);await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 통과/);assert.equal(f.element('current-receipt-download').disabled,false);
});

 test('displayed final gate must agree with the stored artifact result',async()=>{
 const f=await fixture();await f.view('B');const signed=signedUiReceipt(),valid=signed.report;
 const conflicting=[{...valid,artifact:{...valid.artifact,result:{...valid.artifact.result,decision:'block',deploymentAllowed:false}}},{...valid,artifact:{...valid.artifact,result:undefined}},{...valid,artifact:{...valid.artifact,result:{...valid.artifact.result,reasons:['Different reason']}}},{...valid,manualApproval:{status:'approved'}},{...valid,comparison:{comparable:true,deploymentAllowed:true}}];
 for(const response of conflicting){f.overrides.set('/v1/release-gate',()=>response);await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/확인 실패/);assert.equal(f.element('current-receipt-download').disabled,true);assert.equal(f.element('manual-gate-check').disabled,false);await f.element('current-receipt-download').fire('click');assert.equal(f.downloads.length,0);}
 const reordered={...valid,artifact:{...valid.artifact,result:Object.fromEntries(Object.entries(valid.artifact.result).reverse())}};f.overrides.set('/v1/release-gate',()=>reordered);await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 통과/);await f.element('current-receipt-download').fire('click');assert.equal(verifyReceipt(JSON.parse(await f.downloads[0].text()),signed.publicKey).signatureVerified,true);
 });

test('gate record comparison is bounded and preserves supported large regression evidence',async()=>{
 const f=await fixture();await f.view('B');const changes=Array.from({length:2000},(_,i)=>({caseId:'case-'+i,ruleId:'rule',before:'pass',after:'fail'}));
 const normal=releaseResult(false,undefined,{comparison:{comparable:true,deploymentAllowed:false,changes,regressions:changes}});f.overrides.set('/v1/release-gate',()=>normal);await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 차단/);
 let nested={value:true};for(let i=0;i<70;i++)nested={child:nested};
 for(const extra of [nested,Array.from({length:100001},()=>true)]){f.overrides.set('/v1/release-gate',()=>releaseResult(true,undefined,{unexpected:extra}));await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/확인 실패/);assert.equal(f.element('current-receipt-download').disabled,true);assert.equal(f.element('manual-gate-check').disabled,false);}
 f.overrides.set('/v1/release-gate',()=>releaseResult());await f.element('manual-gate-check').fire('click');assert.match(f.element('manual-gate-output').textContent,/최종 게이트: 통과/);
});
