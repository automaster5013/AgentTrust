/** Receives bounded actual Java-signed fixtures in memory, no network or private signing key. */
import {readSync,readFileSync,statSync} from 'node:fs';
import {createPublicKey,createHash,generateKeyPairSync} from 'node:crypto';
import {verifiedObservationBundle} from '../apps/console/src/lib/observation-bundles.ts';
import assert from 'node:assert/strict';
try{
 const chunks:Buffer[]=[];let count=0;while(true){const b=Buffer.alloc(Math.min(16384,786433-count)),n=readSync(0,b,0,b.length,null);if(!n)break;count+=n;if(count>786432)throw Error('INPUT_LIMIT');chunks.push(b.subarray(0,n))}const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));assert.equal(Object.keys(input).sort().join(','),'bundle,campaignId,receiptId,user');
 const path='.local/stack/gate-keys/public-key.pem';assert.ok(statSync(path).isFile()&&statSync(path).size<=4096);const key=createPublicKey(readFileSync(path));assert.equal(key.asymmetricKeyType,'ed25519');const der=key.export({type:'spki',format:'der'}),trust={keyId:createHash('sha256').update(der).digest('hex'),publicKeySpkiBase64:der.toString('base64'),signatureAlgorithm:'Ed25519',trustDomain:'agenttrust-local-development',productionKey:false};
 const verify=(bundle:unknown,anchor:unknown=trust)=>verifiedObservationBundle(bundle,anchor,input.user,input.campaignId,input.receiptId);const proof=await verify(input.bundle);assert.equal(proof.baselineBytesVerified,true);assert.equal(proof.receipt.observedGate.deploymentAllowed,false);
 const variants=[];const omitted=structuredClone(input.bundle);delete omitted.baseline;omitted.schemaVersion=1;variants.push(omitted);
 const child=structuredClone(input.bundle);child.baseline.children[0].archive.contentBase64=Buffer.from('changed original baseline bytes').toString('base64');variants.push(child);
 const shadow=structuredClone(input.bundle);shadow.baseline.parent.storageVersion='shadow-original-version';variants.push(shadow);
 const swap=structuredClone(input.bundle);swap.baseline.children=swap.children;variants.push(swap);
 const scope=structuredClone(input.bundle);scope.baseline.campaign.project_id=input.user.organizationId;variants.push(scope);
 for(const value of variants)await assert.rejects(verify(value));const other=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'});await assert.rejects(verify(input.bundle,{...trust,keyId:createHash('sha256').update(other).digest('hex'),publicKeySpkiBase64:other.toString('base64')}));
 process.stdout.write(JSON.stringify({completed:true,actualSignatureVerified:true,baselineBytesVerified:true,negativeControls:6,networkUsed:false,currentDeploymentAuthority:false})+'\n');
}catch{process.stdout.write(JSON.stringify({completed:false,code:'BASELINE_BYTE_CHAIN_UNVERIFIED',networkUsed:false,currentDeploymentAuthority:false})+'\n');process.exitCode=1}
