/** Receives bounded in-memory live evidence from the authenticated Python reviewer. */
import {openSync,readSync,closeSync,fstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifiedCampaign,verifiedCampaignArchive} from '../apps/console/src/lib/campaign-contracts.ts';
import {verifyAnchoredGateCheck} from './stack-current-gate-anchor.ts';
import type {Identity} from '../apps/console/src/lib/contracts.ts';
function bounded(fd:number,limit:number){const chunks:Buffer[]=[];let count=0;while(true){const chunk=Buffer.alloc(Math.min(16384,limit+1-count)),size=readSync(fd,chunk,0,chunk.length,null);if(size===0)break;count+=size;if(count>limit)throw Error('INPUT_LIMIT');chunks.push(chunk.subarray(0,size));}return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}
try{
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--trusted-public-key'||!args[1])throw Error('INVALID_ARGUMENTS');
 const fd=openSync(args[1],'r');let pem:string;try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>4096)throw Error('INVALID_TRUST_ANCHOR');pem=bounded(fd,4096)}finally{closeSync(fd)}
 const input=JSON.parse(bounded(0,262144));if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='campaignId,challenge,evidence,frame,record,requestStartedAt,user')throw Error('INVALID_INPUT');
 const user=input.user as Identity,record=await verifiedCampaign(input.record,user,input.campaignId),archive=await verifiedCampaignArchive(input.evidence,user,record);
 const check=await verifyAnchoredGateCheck(input.frame,pem,user,record,archive,input.challenge,input.requestStartedAt);
 process.stdout.write(JSON.stringify({completed:true,signatureVerified:true,trustedKeyId:check.keyId,decision:check.observedGate.decision,deploymentAllowedAtRead:check.observedGate.deploymentAllowed,checkedAtEpochMillis:check.checkedAtEpochMillis,expiresAtEpochMillis:check.expiresAtEpochMillis,releaseRequirementsBound:check.releaseRequirements?.enabled===true,releaseRequirementsSha256:check.releaseRequirements?createHash('sha256').update(JSON.stringify(check.releaseRequirements)).digest('hex'):null,currentDeploymentAuthority:false,trustDomain:'agenttrust-local-development',networkUsed:false})+'\n');
}catch{process.stdout.write(JSON.stringify({completed:false,code:'CURRENT_GATE_ANCHOR_UNVERIFIED',currentDeploymentAuthority:false})+'\n');process.exitCode=1}
