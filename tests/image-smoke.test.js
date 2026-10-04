import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyImageDeployment} from '../scripts/image-smoke.mjs';
const digest='ghcr.io/automaster5013/agenttrust@sha256:'+'a'.repeat(64),revision='b'.repeat(40);
function fixture(){
 const container={Config:{Image:digest,User:'node',Env:['AGENTTRUST_HTTPS_TARGETS={}']},Image:'sha256:local',HostConfig:{ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true']},NetworkSettings:{Ports:{},Networks:{backend:{}}},Mounts:[],State:{Health:{Status:'healthy'}}};
 const api=structuredClone(container);api.Config.User='1001:1001';api.NetworkSettings.Ports={'4310/tcp':[{HostIp:'127.0.0.1',HostPort:'4310'}]};api.Mounts=[{Destination:'/run/secrets/receipt-signing-key',RW:false}];
 return {expectedImage:digest,expectedRevision:revision,api,worker:container,image:{Id:'sha256:local',Config:{Labels:{'org.opencontainers.image.revision':revision,'org.opencontainers.image.source':'https://github.com/automaster5013/AgentTrust'}}},network:{Name:'backend',Internal:true}};
}
test('exact registry digest and unprivileged isolated runtime permit promotion evidence',()=>{assert.equal(verifyImageDeployment(fixture()).imageIdentityVerified,true);});
test('mixed runtime images, mutable tags and mismatched source revisions reject promotion evidence',()=>{
 for(const change of [f=>f.expectedImage=digest.split('@')[0]+':main',f=>f.worker.Image='sha256:older',f=>f.worker.Config.Image=digest.replace(/a$/,'c'),f=>f.image.Config.Labels['org.opencontainers.image.revision']='c'.repeat(40),f=>f.image.Config.Labels['org.opencontainers.image.source']='https://github.com/another/AgentTrust']){const f=fixture();change(f);assert.throws(()=>verifyImageDeployment(f));}
});
test('public ports, worker signing key, root user and weakened container isolation reject promotion evidence',()=>{
 for(const change of [f=>f.api.NetworkSettings.Ports['4310/tcp'][0].HostIp='0.0.0.0',f=>f.worker.Mounts=[{Destination:'/run/secrets/receipt-signing-key'}],f=>f.worker.Config.User='root',f=>f.api.HostConfig.ReadonlyRootfs=false,f=>f.worker.HostConfig.CapDrop=[],f=>f.worker.HostConfig.SecurityOpt=[],f=>f.network.Internal=false,f=>f.worker.NetworkSettings.Networks.external={},f=>f.worker.Config.Env=['AGENTTRUST_HTTPS_TARGETS={"connector":{}}']]){const f=fixture();change(f);assert.throws(()=>verifyImageDeployment(f));}
});
