import assert from 'node:assert/strict';
import {open,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {observationInspectionOptions,readObservationReportFile} from './inspect-operations-observation.mjs';
import {renderOperationalObservationReport} from '../packages/operations/observation-report.js';

export function observationReportOptions(args){
 assert.ok(args.length>=2&&typeof args[1]==='string'&&args[1].length>0&&!args[1].startsWith('--')&&/\.html$/i.test(args[1]));
 const inspection=observationInspectionOptions([args[0],...args.slice(2)]),canonical=path=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
 assert.notEqual(canonical(inspection.path),canonical(args[1]));return {...inspection,outputPath:args[1]};
}
export async function writeObservationReport(options,{create=open,remove=unlink}={}){
 assert.ok(options&&Object.keys(options).sort().join(',')==='expected,outputPath,path');
 const flags=Object.entries(options.expected).flatMap(([key,value])=>{assert.ok(['organizationId','projectId'].includes(key));return [key==='organizationId'?'--organization-id':'--project-id',value];});
 options=observationReportOptions([options.path,options.outputPath,...flags]);
 const report=await readObservationReportFile(options.path),rendered=renderOperationalObservationReport(report,options.expected);assert.ok(Buffer.byteLength(rendered.html)<=1048576);
 let handle,owned=false;
 try{handle=await create(options.outputPath,'wx',0o600);owned=true;await handle.writeFile(rendered.html,'utf8');await handle.close();handle=undefined;return {outputCreated:true,observationStatus:rendered.inspection.status,recordedCompleted:rendered.inspection.recordedCompleted,expectedScopeVerified:rendered.inspection.expectedScopeVerified,authenticityVerified:false,runtimeVerified:false,currentHealthVerified:false,currentReleasePermissionVerified:false};}
 catch(error){if(handle)await handle.close().catch(()=>{});if(owned)await remove(options.outputPath).catch(()=>{});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await writeObservationReport(observationReportOptions(process.argv.slice(2)));console.log(JSON.stringify(result));process.exitCode=result.observationStatus==='incomplete'?1:result.observationStatus==='critical'?2:0;}
 catch{console.error('Operational observation report could not be created; an existing output is preserved.');process.exitCode=2;}
}
