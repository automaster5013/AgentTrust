import assert from 'node:assert/strict';
import {open,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export function privateJournal(path,{create=open,replace=rename,remove=unlink}={}){
 assert.ok(typeof path==='string'&&/^\.local\/(?:staging-benchmark-[a-f0-9-]{36}\.json|operations-observation-[a-f0-9-]{36}\/report\.json)$/.test(path));
 let initialized=false,busy=false;
 const serialize=value=>{const bytes=JSON.stringify(value,null,2)+'\n';assert.ok(Buffer.byteLength(bytes)<=1048576);return bytes;};
 async function writeNew(file,bytes,owned){const handle=await create(file,'wx',0o600);owned();try{await handle.writeFile(bytes);}finally{await handle.close();}}
 async function initialize(value){assert.ok(!initialized&&!busy);busy=true;let created=false;try{await writeNew(path,serialize(value),()=>created=true);initialized=true;}finally{try{if(created&&!initialized)await remove(path);}finally{busy=false;}}}
 async function checkpoint(value){
  assert.ok(initialized&&!busy);busy=true;const temporary=path+'.checkpoint-'+randomUUID();let created=false;
  try{await writeNew(temporary,serialize(value),()=>created=true);await replace(temporary,path);created=false;}
  finally{try{if(created)await remove(temporary);}finally{busy=false;}}
 }
 return {initialize,checkpoint};
}
