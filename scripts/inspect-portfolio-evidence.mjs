import {pathToFileURL} from 'node:url';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {inspectPortfolioEvidence,normalizePortfolioExpectation} from './portfolio-evidence-inspection.mjs';

export function parsePortfolioInspectionArguments(args){
 if(!Array.isArray(args)||args.length<2||args.length>9||args.some(value=>typeof value!=='string'||!value.trim()))throw Error('Invalid bundle inspection arguments.');
 const [directory,trustedKeyFile,...options]=args,expected={};let expectedManifestSha256,requireReviewBodies=false;
 for(let i=0;i<options.length;){
  if(options[i]==='--require-reviews'){if(requireReviewBodies)throw Error('Duplicate review requirement.');requireReviewBodies=true;i++;continue;}
  if(i+1>=options.length)throw Error('Missing inspection option value.');
  const flag=options[i],value=options[i+1];
  if(flag==='--manifest-sha256'){
   if(expectedManifestSha256!==undefined||!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid manifest digest.');
   expectedManifestSha256=value;
  }else{
   const field=flag==='--organization-id'?'organizationId':flag==='--project-id'?'projectId':undefined;
   if(!field||Object.hasOwn(expected,field))throw Error('Invalid scope options.');expected[field]=value;
  }
  i+=2;
 }
 return {directory,trustedKeyFile,expectedManifestSha256,requireReviewBodies,expected:normalizePortfolioExpectation(Object.keys(expected).length?expected:undefined)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const {directory,trustedKeyFile,expectedManifestSha256,expected,requireReviewBodies}=parsePortfolioInspectionArguments(process.argv.slice(2));
  const trustedPem=await readTrustedReceiptKey(trustedKeyFile);
  console.log(JSON.stringify(await inspectPortfolioEvidence(directory,trustedPem,expectedManifestSha256,expected,requireReviewBodies)));
 }catch{console.error('Historical portfolio evidence inspection failed. Provide an unmodified bundle, an independently trusted public key and the expected scope.');process.exitCode=2;}
}
