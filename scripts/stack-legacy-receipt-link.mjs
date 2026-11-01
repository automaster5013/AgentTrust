import {constants,realpathSync} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
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
export async function readBoundedLegacyLinkFile(path,maximum){
 if(!Number.isSafeInteger(maximum)||maximum<1||maximum>receiptFileLimit)throw Error('Invalid file bound.');
 const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.size>maximum)throw Error('Regular bounded file required.');
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const current=await handle.stat();if(!current.isFile()||current.dev!==before.dev||current.ino!==before.ino)throw Error('File identity changed.');
  const chunks=[];let used=0;
  while(used<=maximum){const part=Buffer.alloc(Math.min(65536,maximum+1-used));const {bytesRead}=await handle.read(part,0,part.length,null);if(!bytesRead)break;used+=bytesRead;if(used>maximum)throw Error('File limit exceeded.');chunks.push(part.subarray(0,bytesRead));}
  if(!used)throw Error('Empty input refused.');return Buffer.concat(chunks,used);
 }finally{await handle.close();}
}
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
