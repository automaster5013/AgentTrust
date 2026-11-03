import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {legacyCatalogueFromFiles,legacyCatalogueBudget} from '../packages/stack-legacy-link/catalogue.js';
import {legacyLinkTarget} from '../packages/stack-legacy-link/receipt.js';
export function parseLegacyCatalogueArguments(args){
 if(!Array.isArray(args)||args.length<7||args.length>9||args.length%2!==1||args.some(x=>typeof x!=='string'||!x||x.includes('\0')))throw Error('Invalid catalogue arguments.');
 const [catalogueFile,...flags]=args,values={},required=['--target-organization-id','--target-project-id','--catalogue-sha256'];
 for(let i=0;i<flags.length;i+=2){const flag=flags[i];if(![...required,'--max-input-bytes'].includes(flag)||Object.hasOwn(values,flag))throw Error('Invalid catalogue option.');values[flag]=flags[i+1];}
 if(required.some(flag=>!Object.hasOwn(values,flag))||!/^[a-f0-9]{64}$/.test(values['--catalogue-sha256']))throw Error('Missing independent catalogue expectations.');
 const budget=values['--max-input-bytes'];if(budget!==undefined&&!/^[1-9][0-9]{0,7}$/.test(budget))throw Error('Invalid catalogue byte budget.');
 return {catalogueFile,expectedCatalogueSha256:values['--catalogue-sha256'],expectedTarget:legacyLinkTarget({organizationId:values['--target-organization-id'],projectId:values['--target-project-id']}),maximumInputBytes:legacyCatalogueBudget(budget===undefined?undefined:Number(budget))};
}
function isMain(){try{return !!process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href}catch{return false}}
if(isMain()){
 try{console.log(JSON.stringify(await legacyCatalogueFromFiles(parseLegacyCatalogueArguments(process.argv.slice(2)))))}
 catch{console.error('Legacy catalogue preflight failed. Supply unmodified regular input files and independent catalogue, mapping, public-key and target expectations.');process.exitCode=2;}
}
