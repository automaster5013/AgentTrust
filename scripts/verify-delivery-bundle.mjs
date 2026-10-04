import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdir,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBoundedFile,deliveryExpectations} from './verify-delivery.mjs';
import {verifyPromotedDeliveryManifest} from './delivery-manifest.mjs';

export async function verifyDeliveryBundle(directory,env){
  const files=['delivery-manifest.json','delivery-manifest.sha256'];
  assert.deepEqual((await readdir(directory)).sort(),files);
  for(const name of files)assert.ok((await lstat(resolve(directory,name))).isFile());
  const bytes=await readBoundedFile(resolve(directory,files[0]));
  const checksum=new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedFile(resolve(directory,files[1]),128));
  const expected=/^([a-f0-9]{64})  delivery-manifest\.json\r?\n?$/.exec(checksum);
  assert.ok(expected&&expected[0]===checksum);assert.equal(createHash('sha256').update(bytes).digest('hex'),expected[1]);
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return {...verifyPromotedDeliveryManifest(deliveryExpectations(env),manifest),manifestChecksumVerified:true,manifestSha256:expected[1],bundleFileCount:2};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    assert.equal(process.argv.length,3);
    console.log(JSON.stringify({schemaVersion:1,status:'passed',readOnly:true,...await verifyDeliveryBundle(process.argv[2],process.env)}));
  }catch{
    console.log(JSON.stringify({schemaVersion:1,status:'blocked',code:'DELIVERY_BUNDLE_INVALID',readOnly:true,guidance:'Use a folder containing only the original manifest JSON and checksum, and independently chosen delivery expectations. Check CI success separately.'}));
    console.error('Delivery bundle verification blocked.');process.exitCode=1;
  }
}
