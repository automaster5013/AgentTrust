import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {verifyPromotedDeliveryManifest} from './delivery-manifest.mjs';

export async function readBoundedFile(path,maxBytes=65536){
  assert.ok(Number.isInteger(maxBytes)&&maxBytes>0&&maxBytes<=65536);
  const file=await open(path,'r');
  try{
    assert.ok((await file.stat()).isFile());
    const buffer=Buffer.alloc(maxBytes+1);let used=0;
    while(used<buffer.length){const {bytesRead}=await file.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}
    assert.ok(used>0&&used<=maxBytes);
    return buffer.subarray(0,used);
  }finally{await file.close();}
}
export async function readDeliveryManifest(path){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedFile(path)));}
export function deliveryExpectations(env){
  return {GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:env.AGENTTRUST_DELIVERY_REPOSITORY,GITHUB_SHA:env.AGENTTRUST_EXPECTED_REVISION,GITHUB_RUN_ID:env.AGENTTRUST_DELIVERY_RUN_ID,GITHUB_RUN_ATTEMPT:env.AGENTTRUST_DELIVERY_RUN_ATTEMPT,AGENTTRUST_IMAGE:env.AGENTTRUST_IMAGE};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    assert.equal(process.argv.length,3);assert.ok(process.argv[2].endsWith('.json'));
    const report=verifyPromotedDeliveryManifest(deliveryExpectations(process.env),await readDeliveryManifest(process.argv[2]));
    console.log(JSON.stringify({schemaVersion:1,status:'passed',readOnly:true,...report}));
  }catch{
    console.log(JSON.stringify({schemaVersion:1,status:'blocked',code:'DELIVERY_MANIFEST_INVALID',readOnly:true,guidance:'Check the promoted JSON manifest and independently chosen repository, revision, digest, run ID and attempt. Confirm GitHub CI success separately.'}));
    console.error('Delivery manifest verification blocked.');process.exitCode=1;
  }
}
