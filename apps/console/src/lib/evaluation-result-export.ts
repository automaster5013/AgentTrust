import {detail,type Detail,type Identity} from './contracts.ts';
/** An unsigned observation file. It cannot carry a current gate, approval, or release token. */
export function evaluationResultExport(raw:unknown,user:Identity,selected:Detail){
 const previous=detail(selected,user,selected.id),fresh=detail(raw,user,selected.id);
 if(previous.state==='queued'||fresh.state==='queued'||JSON.stringify(previous)!==JSON.stringify(fresh))throw Error('INVALID_EXPORT_BINDING');
 const value={schemaVersion:1,kind:'completed-evaluation-observation',organizationId:user.organizationId,projectId:user.projectId,runId:fresh.id,historicalEvidenceOnly:true,deploymentAuthority:false,signed:false,currentGateIncluded:false,observation:fresh};
 const json=JSON.stringify(value,null,2)+'\n',bytes=new TextEncoder().encode(json).length;
 if(bytes>524288)throw Error('EXPORT_TOO_LARGE');
 return {json,bytes,filename:'agenttrust-observation-'+fresh.id+'.json'};
}
