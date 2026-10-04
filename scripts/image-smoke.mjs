import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function verifyImageDeployment({expectedImage,expectedRevision,api,worker,image,network}){
  assert.match(expectedImage,/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/);
  assert.match(expectedRevision,/^[a-f0-9]{40}$/);
  assert.equal(api.Config.Image,expectedImage);assert.equal(worker.Config.Image,expectedImage);
  assert.equal(api.Image,worker.Image);assert.equal(api.Image,image.Id);
  assert.equal(image.Config.Labels['org.opencontainers.image.revision'],expectedRevision);
  assert.equal(image.Config.Labels['org.opencontainers.image.source']?.toLowerCase(),'https://github.com/'+expectedImage.slice(8).split('@')[0]);
  for(const container of [api,worker]){
    assert.match(container.Config.User,/^(node|[1-9][0-9]*(?::[1-9][0-9]*)?)$/);
    assert.equal(container.HostConfig.ReadonlyRootfs,true);
    assert.ok(container.HostConfig.CapDrop.includes('ALL'));
    assert.ok(container.HostConfig.SecurityOpt.some(option=>option==='no-new-privileges:true'||option==='no-new-privileges'));
  }
  assert.equal(api.State.Health.Status,'healthy');
  const bindings=Object.values(api.NetworkSettings.Ports).flatMap(value=>value||[]);
  assert.equal(bindings.length,1);assert.equal(bindings[0].HostIp,'127.0.0.1');
  assert.equal(Object.values(worker.NetworkSettings.Ports).flatMap(value=>value||[]).length,0);
  assert.deepEqual(Object.keys(worker.NetworkSettings.Networks),[network.Name]);assert.equal(network.Internal,true);
  const signing=api.Mounts.filter(mount=>mount.Destination==='/run/secrets/receipt-signing-key');
  assert.equal(signing.length,1);assert.equal(signing[0].RW,false);assert.equal(worker.Mounts.length,0);
  assert.equal(worker.Config.Env.find(value=>value.startsWith('AGENTTRUST_HTTPS_TARGETS=')),'AGENTTRUST_HTTPS_TARGETS={}');
  return {image:expectedImage,revision:expectedRevision,imageIdentityVerified:true,isolationVerified:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const expectedImage=process.env.AGENTTRUST_IMAGE,expectedRevision=process.env.AGENTTRUST_EXPECTED_REVISION;
    assert.match(expectedImage||'',/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/);assert.match(expectedRevision||'',/^[a-f0-9]{40}$/);
    const inspect=(...args)=>JSON.parse(execFileSync('docker',args,{encoding:'utf8',maxBuffer:1048576,timeout:30000}));
    const ids=execFileSync('docker',['compose','-f','compose.yaml','-f','compose.image.yaml','ps','-q','api','worker'],{encoding:'utf8',timeout:30000}).trim().split(/\s+/);
    assert.equal(ids.length,2);const containers=inspect('inspect',...ids);
    const api=containers.find(container=>container.Config.Labels['com.docker.compose.service']==='api'),worker=containers.find(container=>container.Config.Labels['com.docker.compose.service']==='worker');
    assert.ok(api&&worker);const image=inspect('image','inspect',expectedImage)[0];
    const networks=Object.keys(worker.NetworkSettings.Networks);assert.equal(networks.length,1);
    const network=inspect('network','inspect',networks[0])[0];
    const report={...verifyImageDeployment({expectedImage,expectedRevision,api,worker,image,network}),verifiedAt:new Date().toISOString()};
    await writeFile('.local/image-smoke.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
  }catch{console.error('Registry image verification failed: inspect exact digest, revision and isolation settings.');process.exitCode=1;}
}
