import { InputError } from '../../packages/contracts/index.js';

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
      if(!cursor||Object.keys(cursor).sort().join(',')!=='id,organizationId,projectId,time'||cursor.organizationId!==context.organizationId||cursor.projectId!==context.projectId||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(cursor.id)||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.time)||new Date(cursor.time).toISOString().slice(0,19)!==cursor.time.slice(0,19))throw new Error();
    }catch{throw new InputError('Invalid or foreign project cursor.');}
  }
  return {limit,cursor};
}
export function pageResult(rows,page,context){
  const more=rows.length>page.limit,selected=rows.slice(0,page.limit),last=selected.at(-1);
  return {items:selected.map(({cursor_time,...row})=>row),nextCursor:more?Buffer.from(JSON.stringify({organizationId:context.organizationId,projectId:context.projectId,time:last.cursor_time,id:last.id})).toString('base64url'):null};
}
