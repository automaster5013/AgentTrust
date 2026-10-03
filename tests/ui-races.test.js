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
  addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
  async fire(type,event={}){for(const handler of this.handlers[type]||[])await handler({preventDefault(){},...event});}
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function execution(id,state='succeeded',manual=false){return {id,state,createdAt:'2026-01-01T00:00:00Z',snapshotHash:'synthetic-'+id,
  snapshot:{agent:{name:'Run '+id},dataset:{name:'Synthetic dataset'},policy:{name:'Synthetic policy',requiresManualApproval:manual}},
  agentVersionId:'agent',datasetVersionId:'dataset',policyVersionId:'policy',results:[],summary:{cases:0,pass:0,fail:0,inconclusive:0},
  gate:{decision:state==='succeeded'?'pass':'inconclusive',deploymentAllowed:state==='succeeded'&&!manual,...(manual?{requiresManualApproval:true,evaluationPassed:state==='succeeded'}:{})}};}
async function fixture({manual=false}={}){
  const nodes=new Map(),selects=new Set(['agent','dataset-select','policy','workspace-project','ci-project','baseline-run','history-state','history-decision','audit-action','agent-mode']);
  const element=id=>{if(!nodes.has(id))nodes.set(id,new Element(selects.has(id)?'select':'div'));return nodes.get(id);};
  const document={getElementById:element,createElement:tag=>new Element(tag)},timers=[],overrides=new Map();
  element('timeout-ms').value='30000';element('case-budget').value='100';
  const runs={A:execution('A','running'),B:execution('B','succeeded',manual)};
  const defaultResponse=path=>{
    if(path==='/v1/me')return {role:'admin',projectId:'project',organizationName:'Synthetic',name:'Tester',projects:[{id:'project',name:'Synthetic'}]};
    if(path==='/v1/catalog')return {agent:[{id:'agent',name:'Agent',mode:'compliant'}],dataset:[{id:'dataset',name:'Dataset',cases:1}],policy:[{id:'policy',name:'Policy',minimumPassRate:1}]};
    if(path==='/v1/sample-dataset')return {name:'Synthetic',cases:[]};
    if(path.startsWith('/v1/runs?'))return {items:Object.values(runs).map(run=>({id:run.id,agentName:'Run '+run.id,datasetName:'Dataset',state:run.state,gate:run.gate,createdAt:run.createdAt})),nextCursor:null};
    if(path==='/v1/operations')return {worker:{state:'recent',lastSeen:null},queue:{queued:1,running:0,overdue:0,expiredLeases:0},recent:{completed24h:1,errors24h:0},observedAt:'2026-01-01T00:00:00Z'};
    if(path==='/v1/usage')return {completed_runs:1,evaluated_cases:1,attempts:1};
    if(path.startsWith('/v1/runs/')&&path.endsWith('/reviews'))return [];
    if(path.startsWith('/v1/runs/'))return runs[path.split('/')[3]];
    return {items:[],nextCursor:null};
  };
  const fetch=async(path,options={})=>{const handler=overrides.get(path),data=handler?await handler(options):defaultResponse(path);return {status:200,ok:true,json:async()=>data};};
  const source=await readFile(new URL('../apps/web/app.js',import.meta.url),'utf8');
  const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  await new AsyncFunction('document','fetch','setTimeout','crypto',source)(document,fetch,callback=>{timers.push(callback);},webcrypto);
  const view=id=>{const row=element('history-body').children.find(row=>row.children[0].textContent==='Run '+id);return row.children.at(-1).children[0].fire('click');};
  return {element,overrides,timers,runs,view};
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
  f.overrides.set('/v1/runs/B/reviews',options=>options.method==='POST'?submission.promise:[]);
  const pending=f.element('review-form').fire('submit',{submitter:{value:'approved'}});await settle();
  await f.element('review-refresh').fire('click');assert.equal(f.element('review-approve').disabled,true);assert.equal(f.element('review-reject').disabled,true);
  submission.resolve({id:'synthetic-review'});await pending;assert.equal(f.element('review-approve').disabled,false);
});
