import {open} from 'node:fs/promises';
import {trustedReceiptKey} from '../packages/receipts/signature.js';
export const trustedKeyFileLimit=1024;
export async function readTrustedReceiptKey(path){
  const file=await open(path,'r');
  try{
    if(!(await file.stat()).isFile())throw Error('Trusted key must be a regular file.');
    const buffer=Buffer.alloc(trustedKeyFileLimit+1);let used=0;
    while(used<buffer.length){const {bytesRead}=await file.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}
    if(!used||used>trustedKeyFileLimit)throw Error('Trusted public key exceeds size limit.');
    const pem=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,used));trustedReceiptKey(pem);return pem;
  }finally{await file.close();}
}
