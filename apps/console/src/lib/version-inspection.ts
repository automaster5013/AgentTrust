import type {Identity} from './contracts.ts';
import {verifiedAgentVersion,verifiedDatasetVersion,type AgentVersion,type DatasetVersion,type Version} from './campaign-contracts.ts';
import {verifyVersionHistoryBinding,type VersionKind} from './version-history.ts';
export type InspectedVersion={kind:VersionKind;value:AgentVersion|DatasetVersion;definitionJson:string};
/** Only a scope/hash/coordinate-verified definition may reach the text inspector. */
export async function inspectRegisteredVersion(raw:unknown,user:Identity,kind:VersionKind,row:Version):Promise<InspectedVersion>{
 if(kind!=='agents'&&kind!=='datasets')throw Error('INVALID_VERSION_KIND');
 const value=kind==='agents'?await verifiedAgentVersion(raw,user):await verifiedDatasetVersion(raw,user);
 verifyVersionHistoryBinding(row,value);
 const definitionJson=JSON.stringify(value.definition,null,2);
 if(new TextEncoder().encode(definitionJson).length>16384)throw Error('INVALID_DEFINITION_SIZE');
 return {kind,value,definitionJson};
}
