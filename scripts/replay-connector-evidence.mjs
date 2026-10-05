import {fileURLToPath,pathToFileURL} from 'node:url';
import {readConnectorJson} from './check-connector-contract.mjs';
import {evaluateRecordedConnector} from '../packages/evaluator/connector-replay.js';
export function parseReplayFiles(args){
 if(!args.length)return Object.fromEntries(['dataset','policy','trace'].map(name=>[name,fileURLToPath(new URL('../examples/connector-contract/'+name+'.json',import.meta.url))]).concat([['syntheticExample',true]]));
 const files={},seen=new Set();
 for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!['--dataset','--policy','--trace'].includes(flag)||seen.has(flag)||typeof value!=='string'||!value||value.startsWith('--'))throw Error('Invalid recorded evidence options');seen.add(flag);files[flag.slice(2)]=value;}
 if(seen.size!==3)throw Error('All recorded evaluation files are required');return {...files,syntheticExample:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let stage='inputs';
 try{
  const files=parseReplayFiles(process.argv.slice(2)),input={};
  for(const name of ['dataset','policy','trace']){stage=name;input[name]=(await readConnectorJson(files[name])).value;}
  stage='evaluation';const report=evaluateRecordedConnector(input);Object.assign(report,{syntheticExample:files.syntheticExample});console.log(JSON.stringify(report));if(!report.evaluationPassed)process.exitCode=1;
 }catch{console.log(JSON.stringify({schemaVersion:1,purpose:'connector-recorded-evaluation',status:'blocked',failedStage:stage,offlineOnly:true,networkRequestsMade:0,recordedSourceVerified:false,releaseGateEvaluated:false,deploymentAllowed:false}));process.exitCode=2;}
}
