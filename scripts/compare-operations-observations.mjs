import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {observationInspectionOptions,readObservationReportFile} from './inspect-operations-observation.mjs';
import {compareOperationalObservations} from '../packages/operations/observation-comparison.js';

export function observationComparisonOptions(args){
 assert.ok(args.length>=2&&typeof args[1]==='string'&&args[1].length>0&&!args[1].startsWith('--'));
 const base=observationInspectionOptions([args[0],...args.slice(2)]);assert.ok(base.path.length>0);
 return {baselinePath:base.path,candidatePath:args[1],expected:base.expected};
}
export async function compareObservationFiles(options){
 assert.ok(options&&Object.keys(options).sort().join(',')==='baselinePath,candidatePath,expected');
 const flags=Object.entries(options.expected).flatMap(([key,value])=>{assert.ok(['organizationId','projectId'].includes(key));return [key==='organizationId'?'--organization-id':'--project-id',value];});
 options=observationComparisonOptions([options.baselinePath,options.candidatePath,...flags]);
 const [baseline,candidate]=await Promise.all([readObservationReportFile(options.baselinePath),readObservationReportFile(options.candidatePath)]);
 return compareOperationalObservations(baseline,candidate,options.expected);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await compareObservationFiles(observationComparisonOptions(process.argv.slice(2)));console.log(JSON.stringify(result));process.exitCode=result.status==='incomplete'?1:result.status==='critical'?2:0;}
 catch{console.error('Operational observation comparison could not be verified; no current release permission is available.');process.exitCode=2;}
}
