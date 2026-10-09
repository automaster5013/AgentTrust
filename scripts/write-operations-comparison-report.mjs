import assert from 'node:assert/strict';
import {open,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {observationComparisonOptions} from './compare-operations-observations.mjs';
import {readObservationReportFile} from './inspect-operations-observation.mjs';
import {renderOperationalObservationComparison} from '../packages/operations/observation-comparison-report.js';
export function observationComparisonReportOptions(args){
 assert.ok(args.length>=3&&typeof args[2]==='string'&&args[2].length>0&&!args[2].startsWith('--')&&/\.html$/i.test(args[2]));
 const options=observationComparisonOptions([args[0],args[1],...args.slice(3)]),canonical=p=>process.platform==='win32'?resolve(p).toLowerCase():resolve(p);
 assert.ok(![options.baselinePath,options.candidatePath].some(p=>canonical(p)===canonical(args[2])));
 return {...options,outputPath:args[2]};
}
export async function writeObservationComparisonReport(options,{create=open,remove=unlink}={}){
 assert.ok(options&&Object.keys(options).sort().join(',')==='baselinePath,candidatePath,expected,outputPath');
 const flags=Object.entries(options.expected).flatMap(([key,value])=>{assert.ok(['organizationId','projectId'].includes(key));return [key==='organizationId'?'--organization-id':'--project-id',value];});
 options=observationComparisonReportOptions([options.baselinePath,options.candidatePath,options.outputPath,...flags]);
 const [baseline,candidate]=await Promise.all([readObservationReportFile(options.baselinePath),readObservationReportFile(options.candidatePath)]),rendered=renderOperationalObservationComparison(baseline,candidate,options.expected);assert.ok(Buffer.byteLength(rendered.html)<=1048576);
 let handle,owned=false;
 try{handle=await create(options.outputPath,'wx',0o600);owned=true;await handle.writeFile(rendered.html,'utf8');await handle.close();handle=undefined;return {outputCreated:true,comparisonStatus:rendered.comparison.status,sameRecordedScopeVerified:true,expectedScopeVerified:rendered.comparison.expectedScopeVerified,authenticityVerified:false,runtimeVerified:false,currentHealthVerified:false,currentReleasePermissionVerified:false};}
 catch(error){if(handle)await handle.close().catch(()=>{});if(owned)await remove(options.outputPath).catch(()=>{});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await writeObservationComparisonReport(observationComparisonReportOptions(process.argv.slice(2)));console.log(JSON.stringify(result));process.exitCode=result.comparisonStatus==='incomplete'?1:result.comparisonStatus==='critical'?2:0;}
 catch{console.error('Operational comparison report could not be created; an existing output is preserved.');process.exitCode=2;}
}
