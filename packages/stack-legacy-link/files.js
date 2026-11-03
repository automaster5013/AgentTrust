import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {receiptFileLimit} from '../receipts/limits.js';
export async function readBoundedLegacyLinkFile(path,maximum){
 if(!Number.isSafeInteger(maximum)||maximum<1||maximum>receiptFileLimit)throw Error('Invalid file bound.');
 const before=await lstat(path,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size>BigInt(maximum))throw Error('Regular bounded file required.');
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const current=await handle.stat({bigint:true});if(!current.isFile()||current.dev!==before.dev||current.ino!==before.ino)throw Error('File identity changed.');
  const chunks=[];let used=0;
  while(used<=maximum){const part=Buffer.alloc(Math.min(65536,maximum+1-used));const {bytesRead}=await handle.read(part,0,part.length,null);if(!bytesRead)break;used+=bytesRead;if(used>maximum)throw Error('File limit exceeded.');chunks.push(part.subarray(0,bytesRead));}
  if(!used)throw Error('Empty input refused.');return Buffer.concat(chunks,used);
 }finally{await handle.close();}
}
