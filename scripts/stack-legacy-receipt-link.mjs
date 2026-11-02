import {readBoundedLegacyLinkFile} from '../packages/stack-legacy-link/files.js';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {inspectLegacyReceiptLink,legacyLinkTarget,legacyLinkMappingByteLimit} from '../packages/stack-legacy-link/receipt.js';
import {receiptFileLimit} from '../packages/receipts/limits.js';
import {trustedReceiptKey} from '../packages/receipts/signature.js';
export function parseLegacyLinkArguments(args){
 if(!Array.isArray(args)||args.length!==9||args.some(value=>typeof value!=='string'||!value||value.includes('\0')))throw Error('Invalid legacy link arguments.');
 const [receiptFile,trustedKeyFile,mappingFile,...flags]=args,values={},allowed=['--target-organization-id','--target-project-id','--mapping-sha256'];
 for(let i=0;i<flags.length;i+=2){if(!allowed.includes(flags[i])||Object.hasOwn(values,flags[i]))throw Error('Invalid legacy link option.');values[flags[i]]=flags[i+1];}
 if(allowed.some(flag=>!Object.hasOwn(values,flag))||!/^[a-f0-9]{64}$/.test(values['--mapping-sha256']))throw Error('Missing independent link expectations.');
 return {receiptFile,trustedKeyFile,mappingFile,expectedMappingSha256:values['--mapping-sha256'],expectedTarget:legacyLinkTarget({organizationId:values['--target-organization-id'],projectId:values['--target-project-id']})};
}
export {readBoundedLegacyLinkFile} from '../packages/stack-legacy-link/files.js';
export async function legacyLinkFromFiles(options){
 const mappingBytes=await readBoundedLegacyLinkFile(options.mappingFile,legacyLinkMappingByteLimit);
 const keyBytes=await readBoundedLegacyLinkFile(options.trustedKeyFile,1024),trustedPublicKey=new TextDecoder('utf-8',{fatal:true}).decode(keyBytes);trustedReceiptKey(trustedPublicKey);
 const receiptBytes=await readBoundedLegacyLinkFile(options.receiptFile,receiptFileLimit);
 return inspectLegacyReceiptLink({...options,mappingBytes,trustedPublicKey,receiptBytes});
}
function isMain(){try{return !!process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href}catch{return false}}
if(isMain()){
 try{console.log(JSON.stringify(await legacyLinkFromFiles(parseLegacyLinkArguments(process.argv.slice(2)))))}
 catch{console.error('Legacy receipt link preflight failed. Supply unmodified source files, an independently trusted public key and explicit mapping/target expectations.');process.exitCode=2;}
}
