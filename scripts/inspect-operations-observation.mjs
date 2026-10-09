import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {inspectOperationalObservation} from '../packages/operations/observation-evidence.js';
export function observationInspectionOptions(args){
 assert.ok(args.length>=1&&typeof args[0]==='string'&&!args[0].startsWith('--'));
 const expected={},seen=new Set(),flags=new Map([['--organization-id','organizationId'],['--project-id','projectId']]);
 for(let i=1;i<args.length;i+=2){const key=flags.get(args[i]),value=args[i+1];assert.ok(key&&!seen.has(key)&&typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value));seen.add(key);expected[key]=value.toLowerCase();}
 assert.equal(Object.hasOwn(expected,'organizationId'),Object.hasOwn(expected,'projectId'));return {path:args[0],expected};
}
export async function inspectObservationFile(options){
 const handle=await open(options.path,'r');let bytes;
 try{const stat=await handle.stat();assert.ok(stat.isFile()&&stat.size>0&&stat.size<=1048576);const buffer=Buffer.alloc(1048577);let offset=0;for(;;){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);offset+=bytesRead;if(!bytesRead)break;assert.ok(offset<=1048576);}bytes=buffer.subarray(0,offset);}finally{await handle.close();}
 const report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return inspectOperationalObservation(report,options.expected);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const report=await inspectObservationFile(observationInspectionOptions(process.argv.slice(2)));console.log(JSON.stringify(report));process.exitCode=report.status==='incomplete'?1:report.criticalObserved?2:0;}
 catch{console.error('Operational observation file could not be inspected; no runtime verification is available.');process.exitCode=2;}
}
