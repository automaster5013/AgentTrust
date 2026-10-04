import { InputError } from '../../packages/contracts/index.js';
import { hash } from '../../packages/contracts/hash.js';

export function pagination(query,context){
  if(!query.size)return undefined;
  if([...query.keys()].some(key=>!['limit','cursor'].includes(key))||query.getAll('limit').length>1||query.getAll('cursor').length>1)throw new InputError('Invalid pagination parameters.');
  const raw=query.get('limit')||'25',limit=Number(raw);
  if(!/^[1-9][0-9]{0,2}$/.test(raw)||limit>100)throw new InputError('Page limit must be 1..100.');
  let cursor;
  if(query.has('cursor')){
    const text=query.get('cursor');
    try{
      if(!text||text.length>512||!/^[A-Za-z0-9_-]+$/.test(text))throw new Error();
      const bytes=Buffer.from(text,'base64url');if(bytes.toString('base64url')!==text)throw new Error();cursor=JSON.parse(bytes.toString('utf8'));
      if(!cursor||Object.keys(cursor).sort().join(',')!==(context.cursorScope?'id,organizationId,projectId,scope,time':'id,organizationId,projectId,time')||cursor.organizationId!==context.organizationId||cursor.projectId!==context.projectId||(context.cursorScope&&cursor.scope!==context.cursorScope)||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(cursor.id)||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.time)||new Date(cursor.time).toISOString().slice(0,19)!==cursor.time.slice(0,19))throw new Error();
    }catch{throw new InputError('Invalid or foreign project cursor.');}
  }
  return {limit,cursor};
}
export function pageResult(rows,page,context){
  const more=rows.length>page.limit,selected=rows.slice(0,page.limit),last=selected.at(-1);
  return {items:selected.map(({cursor_time,...row})=>row),nextCursor:more?Buffer.from(JSON.stringify({organizationId:context.organizationId,projectId:context.projectId,...(context.cursorScope?{scope:context.cursorScope}:{}),time:last.cursor_time,id:last.id})).toString('base64url'):null};
}
export function runPagination(query,context){
  const state=query.get('state'),decision=query.get('decision');
  if(query.getAll('state').length>1||query.getAll('decision').length>1||state!==null&&!['queued','running','succeeded','failed','cancelled','timed_out'].includes(state)||decision!==null&&!['pass','block','inconclusive'].includes(decision))throw new InputError('Invalid execution history filters.');
  const filters={state,decision},cursorContext={...context,cursorScope:hash({resource:'runs',filters})},pageQuery=new URLSearchParams(query);
  pageQuery.delete('state');pageQuery.delete('decision');
  return {filters,cursorContext,page:pagination(pageQuery,cursorContext)};
}

export function auditPagination(query,context){
  const action=query.get('action');
  if(query.getAll('action').length>1||action!==null&&!/^[a-z][a-z0-9_.]{0,79}$/.test(action))throw new InputError('Invalid audit action filter.');
  const cursorContext={...context,cursorScope:hash({resource:'audit-events',action})},pageQuery=new URLSearchParams(query);
  pageQuery.delete('action');return {action,cursorContext,page:pagination(pageQuery,cursorContext)};
}


export function sequencePagination(query,context){
  if(!query.size)return undefined;
  if([...query.keys()].some(key=>!['limit','cursor'].includes(key))||query.getAll('limit').length>1||query.getAll('cursor').length>1)throw new InputError('Invalid pagination parameters.');
  const {limit}=pagination(new URLSearchParams({limit:query.get('limit')||'25'}),context);let cursor;
  if(query.has('cursor'))try{
    const text=query.get('cursor');if(!text||text.length>512||!/^[A-Za-z0-9_-]+$/.test(text))throw new Error();
    const bytes=Buffer.from(text,'base64url');if(bytes.toString('base64url')!==text)throw new Error();cursor=JSON.parse(bytes.toString('utf8'));
    if(!cursor||Object.keys(cursor).sort().join(',')!=='order,organizationId,projectId,scope'||cursor.organizationId!==context.organizationId||cursor.projectId!==context.projectId||cursor.scope!==context.cursorScope||typeof cursor.order!=='string'||!/^[1-9][0-9]{0,18}$/.test(cursor.order)||BigInt(cursor.order)>9223372036854775807n)throw new Error();
  }catch{throw new InputError('Invalid or foreign review cursor.');}
  return {limit,cursor};
}
export function sequencePageResult(rows,page,context){
  const more=rows.length>page.limit,selected=rows.slice(0,page.limit),last=selected.at(-1);
  return {items:selected.map(({cursor_order,...row})=>row),nextCursor:more?Buffer.from(JSON.stringify({organizationId:context.organizationId,projectId:context.projectId,scope:context.cursorScope,order:String(last.cursor_order)})).toString('base64url'):null};
}


export function receiptPagination(query,context){
  const decision=query.get('decision'),rawCandidate=query.get('candidateRunId');
  if(query.getAll('decision').length>1||query.getAll('candidateRunId').length>1||decision!==null&&!['pass','block'].includes(decision)||rawCandidate!==null&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(rawCandidate))throw new InputError('Invalid release receipt filters.');
  const filters={decision,candidateRunId:rawCandidate?.toLowerCase()??null},cursorContext={...context,cursorScope:hash({resource:'release-receipts',filters})},pageQuery=new URLSearchParams(query);
  pageQuery.delete('decision');pageQuery.delete('candidateRunId');return {filters,cursorContext,page:pagination(pageQuery,cursorContext)};
}
