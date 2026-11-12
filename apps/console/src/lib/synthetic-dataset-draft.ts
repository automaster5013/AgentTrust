import type {Identity} from './contracts.ts';
import {datasetDefinition,verifiedDatasetVersion,type CaseDefinition,type DatasetVersion} from './campaign-contracts.ts';
export type SyntheticDatasetInput={key:string;version:number;evaluationMode:'fixed-scenarios';cases:CaseDefinition[]};
export function syntheticDatasetExample():CaseDefinition[]{return [{id:'required-pass',scenario:'pass',required:true},{id:'optional-block',scenario:'block',required:false},{id:'optional-missing',scenario:'missing_evidence',required:false},{id:'optional-error',scenario:'error',required:false}]}
export function syntheticDatasetInput(key:string,number:string,text:string):SyntheticDatasetInput{
 if(!/^[a-z][a-z0-9-]{2,63}$/.test(key)||!/^([1-9][0-9]{0,6})$/.test(number)||Number(number)>1000000||new TextEncoder().encode(text).length>4096)throw Error('INVALID_SYNTHETIC_DRAFT');
 const definition=datasetDefinition({contract:'fixed-scenarios-v1',cases:JSON.parse(text)});
 return {key,version:Number(number),evaluationMode:'fixed-scenarios',cases:definition.cases};
}
export async function verifiedSyntheticDataset(value:unknown,user:Identity,input:SyntheticDatasetInput):Promise<DatasetVersion>{
 const result=await verifiedDatasetVersion(value,user);
 if(result.resource_key!==input.key||result.version!==input.version||result.definition.contract!=='fixed-scenarios-v1'||JSON.stringify(result.definition.cases)!==JSON.stringify(input.cases))throw Error('INVALID_SYNTHETIC_REGISTRATION');
 return result;
}
