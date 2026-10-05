import {fileURLToPath,pathToFileURL} from 'node:url';
import {readConnectorJson} from './check-connector-contract.mjs';
import {compareRecordedConnectors} from '../packages/evaluator/connector-compare.js';
export function parseCompareFiles(args){
 const names=['dataset','policy','baseline','candidate'];
 if(!args.length)return Object.fromEntries(names.map(name=>[name,fileURLToPath(new URL('../examples/connector-contract/'+(['baseline','candidate'].includes(name)?'trace':name)+'.json',import.meta.url))]).concat([['syntheticExample',true]]));
 const files={},seen=new Set();
 for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!names.map(name=>'--'+name).includes(flag)||seen.has(flag)||typeof value!=='string'||!value||value.startsWith('--'))throw Error('Invalid comparison options');seen.add(flag);files[flag.slice(2)]=value;}
 if(seen.size!==4)throw Error('All comparison files are required');return {...files,syntheticExample:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let stage='inputs';
 try{const files=parseCompareFiles(process.argv.slice(2)),input={};for(const name of ['dataset','policy','baseline','candidate']){stage=name;input[name]=(await readConnectorJson(files[name])).value;}stage='comparison';const report=compareRecordedConnectors(input);report.syntheticExample=files.syntheticExample;console.log(JSON.stringify(report));if(!report.comparisonPassed)process.exitCode=1;}
 catch{console.log(JSON.stringify({schemaVersion:1,purpose:'connector-recorded-comparison',status:'blocked',failedStage:stage,offlineOnly:true,networkRequestsMade:0,recordedSourceVerified:false,releaseGateEvaluated:false,deploymentAllowed:false}));process.exitCode=2;}
}
