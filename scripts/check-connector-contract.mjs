import {open} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseJson} from '../packages/contracts/json.js';
import {validate} from '../packages/contracts/index.js';
import {validateEvidence} from '../packages/evaluator/https-adapter.js';
export const connectorFileLimit=65536;
export async function readConnectorJson(path){
 const file=await open(path,'r');
 try{
  if(!(await file.stat()).isFile())throw Error('Connector input must be a regular file');
  const buffer=Buffer.alloc(connectorFileLimit+1);let used=0;
  while(used<buffer.length){const {bytesRead}=await file.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}
  if(!used||used>connectorFileLimit)throw Error('Connector file size is invalid');
  return {value:parseJson(buffer.subarray(0,used)),bytes:used};
 }finally{await file.close();}
}
export function parseConnectorFiles(args){
 if(!args.length)return {request:fileURLToPath(new URL('../examples/connector-contract/request.json',import.meta.url)),response:fileURLToPath(new URL('../examples/connector-contract/response.json',import.meta.url)),syntheticExample:true};
 const options={},seen=new Set();
 for(let i=0;i<args.length;i+=2){
  const flag=args[i],value=args[i+1];if(!['--request','--response'].includes(flag)||seen.has(flag)||typeof value!=='string'||!value||value.startsWith('--'))throw Error('Invalid connector file options');
  seen.add(flag);options[flag.slice(2)]=value;
 }
 if(seen.size!==2)throw Error('Both connector files are required');return {...options,syntheticExample:false};
}
export function checkConnectorContract(request,response){
 validate('connectorRequest',request);validateEvidence(response);
 return {schemaVersion:1,purpose:'connector-contract-validation',status:'passed',requestValid:true,responseValid:true,networkRequestsMade:0,releaseGateEvaluated:false,deploymentAllowed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let stage='inputs';
 try{
  const options=parseConnectorFiles(process.argv.slice(2));stage='request';const request=await readConnectorJson(options.request);validate('connectorRequest',request.value);
  stage='response';const response=await readConnectorJson(options.response);validateEvidence(response.value);
  const report=checkConnectorContract(request.value,response.value);Object.assign(report,{syntheticExample:options.syntheticExample,requestBytes:request.bytes,responseBytes:response.bytes});console.log(JSON.stringify(report));
 }catch{console.log(JSON.stringify({schemaVersion:1,purpose:'connector-contract-validation',status:'blocked',failedStage:stage,networkRequestsMade:0,releaseGateEvaluated:false,deploymentAllowed:false}));process.exitCode=1;}
}
