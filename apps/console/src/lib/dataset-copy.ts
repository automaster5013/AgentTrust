import type {Identity} from './contracts.ts';
import {datasetVersion,verifiedDatasetVersion,type DatasetVersion} from './campaign-contracts.ts';
export type DatasetCopyInput={key:string;version:number;evaluationMode:'fixed-scenarios'|'reference-answer'|'recorded-text-rules';cases:DatasetVersion['definition']['cases']};
export function datasetCopyDraft(source:DatasetVersion):DatasetCopyInput{return {key:source.resource_key.slice(0,59)+'-copy',version:1,evaluationMode:source.definition.contract==='recorded-text-rules-v1'?'recorded-text-rules':source.definition.contract==='reference-answer-v1'?'reference-answer':'fixed-scenarios',cases:structuredClone(source.definition.cases)}}
export function datasetCopyInput(source:DatasetVersion,user:Identity,key:string,number:string,text:string):DatasetCopyInput{
 if(text.length>4096||!/^[1-9][0-9]{0,6}$/.test(number))throw Error('INVALID_DATASET_DRAFT');
 const version=Number(number);if(key===source.resource_key&&version===source.version)throw Error('CHOOSE_NEW_VERSION');
 const parsed=datasetVersion({...source,resource_key:key,version,organization_id:user.organizationId,project_id:user.projectId,definition:{contract:source.definition.contract,cases:JSON.parse(text)}},user);
 return {key:parsed.resource_key,version:parsed.version,evaluationMode:source.definition.contract==='recorded-text-rules-v1'?'recorded-text-rules':source.definition.contract==='reference-answer-v1'?'reference-answer':'fixed-scenarios',cases:parsed.definition.cases};
}
export async function verifiedDatasetCopy(value:unknown,user:Identity,input:DatasetCopyInput,source:DatasetVersion):Promise<DatasetVersion>{
 const result=await verifiedDatasetVersion(value,user);
 if(result.id===source.id||result.resource_key!==input.key||result.version!==input.version||result.definition.contract!==(input.evaluationMode==='recorded-text-rules'?'recorded-text-rules-v1':input.evaluationMode==='reference-answer'?'reference-answer-v1':'fixed-scenarios-v1')||JSON.stringify(result.definition.cases)!==JSON.stringify(input.cases))throw Error('INVALID_DATASET_COPY');
 return result;
}

export function datasetCopyRequest(input:DatasetCopyInput){return input.evaluationMode==='recorded-text-rules'?{key:input.key,version:input.version,evaluationMode:input.evaluationMode,recordedCases:input.cases}:input}
