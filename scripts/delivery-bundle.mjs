import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyPromotedDeliveryManifest} from './delivery-manifest.mjs';
import {readDeliveryManifest} from './verify-delivery.mjs';

export function publicDeliveryBundle(env,manifest){
  const verified=verifyPromotedDeliveryManifest(env,manifest);
  const {schemaVersion,repository,revision,image,workflow,state,verification,promotedAt,serverDeployed}=verified;
  const contents=JSON.stringify({schemaVersion,repository,revision,image,workflow,state,verification,promotedAt,serverDeployed},null,2)+'\n';
  const sha256=createHash('sha256').update(contents,'utf8').digest('hex');
  return {files:{'delivery-manifest.json':contents,'delivery-manifest.sha256':sha256+'  delivery-manifest.json\n'},sha256,runId:workflow.runId,attempt:workflow.attempt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    assert.equal(process.argv.length,2);
    const bundle=publicDeliveryBundle(process.env,await readDeliveryManifest('.local/delivery-manifest.json'));
    const root=fileURLToPath(new URL('..',import.meta.url)),parent=resolve(root,'delivery-artifacts'),directory=resolve(parent,bundle.runId+'-'+bundle.attempt);
    await mkdir(parent,{recursive:true});await mkdir(directory);
    for(const [name,contents] of Object.entries(bundle.files))await writeFile(resolve(directory,name),contents,{flag:'wx',mode:0o600});
    console.log(JSON.stringify({publicDeliveryBundlePrepared:true,manifestSha256:bundle.sha256,fileCount:2}));
  }catch{console.error('Public delivery bundle blocked. Check the verified promoted manifest; existing output is never overwritten.');process.exitCode=1;}
}
