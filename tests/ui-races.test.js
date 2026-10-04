import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

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
function execution(id,state='succeeded',manual=false){return {id,state,createdAt:'2026-01-01T00:00:00Z',snapshotHash:'synthetic-'+id,
  snapshot:{agent:{name:'Run '+id},dataset:{name:'Synthetic dataset'},policy:{name:'Synthetic policy',requiresManualApproval:manual}},
  agentVersionId:'agent',datasetVersionId:'dataset',policyVersionId:'policy',results:[],summary:{cases:0,pass:0,fail:0,inconclusive:0},
  gate:{decision:state==='succeeded'?'pass':'inconclusive',deploymentAllowed:state==='succeeded'&&!manual,...(manual?{requiresManualApproval:true,evaluationPassed:state==='succeeded'}:{})}};}
async function fixture({manual=false,initialOverrides,waitForInitialization=true}={}){
  const nodes=new Map(),selects=new Set(['agent','dataset-select','policy','workspace-project','ci-project','baseline-run','history-state','history-decision','audit-action','agent-mode']);
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
  const fetch=async(path,options={})=>{const handler=overrides.get(path),data=handler?await handler(options):defaultResponse(path);return {status:200,ok:true,json:async()=>data};};
  const source=await readFile(new URL('../apps/web/app.js',import.meta.url),'utf8');
  const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  const initialized=new AsyncFunction('document','fetch','setTimeout','crypto','URL',source)(document,fetch,callback=>{timers.push(callback);},webcrypto,{createObjectURL:blob=>{downloads.push(blob);return 'blob:synthetic';},revokeObjectURL(){}});
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
 assert.equal(f.element('workspace-ui').hidden,true);assert.equal(f.element('loading-panel').hidden,true);assert.equal(f.element('login-panel').hidden,false);assert.equal(f.element('login-button').disabled,false);assert.equal(f.element('login-status').textContent,'Synthetic initialization read failed');
});
test('data loading failure after login cannot leave the loading panel stuck',async()=>{
 const f=await fixture();await f.element('logout-button').fire('click');f.overrides.set('/v1/ci-credentials?limit=25',()=>{throw new Error('Synthetic post-login read failed');});f.element('access-key').value='synthetic-key';await f.element('login-form').fire('submit');
 assert.equal(f.element('workspace-ui').hidden,true);assert.equal(f.element('loading-panel').hidden,true);assert.equal(f.element('login-panel').hidden,false);assert.equal(f.element('login-button').disabled,false);assert.equal(f.element('access-key').value,'');assert.equal(f.element('login-status').textContent,'Synthetic post-login read failed');
});

const releaseResult=(allowed=true)=>({deploymentAllowed:allowed,reasons:allowed?[]:['A required rule failed.'],artifact:{checkedAt:'2026-01-01T00:00:00Z',receiptId:'synthetic-receipt'}});
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
