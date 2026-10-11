/** Independent public-key anchoring for a freshly requested development gate observation. */
import {createPublicKey,createHash} from 'node:crypto';
import {verifiedGateCheck} from '../apps/console/src/lib/gate-check-contracts.ts';
import type {Identity} from '../apps/console/src/lib/contracts.ts';
import type {Campaign,CampaignArchive} from '../apps/console/src/lib/campaign-contracts.ts';
export async function verifyAnchoredGateCheck(frame:unknown,pem:string,user:Identity,record:Campaign,archive:CampaignArchive,challenge:string,started:number,now=Date.now()){
 if(Buffer.byteLength(pem,'utf8')>4096||!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(pem))throw Error('INVALID_TRUST_ANCHOR');
 const key=createPublicKey(pem);if(key.asymmetricKeyType!=='ed25519')throw Error('INVALID_TRUST_ANCHOR');
 const der=key.export({type:'spki',format:'der'});if(der.length!==44)throw Error('INVALID_TRUST_ANCHOR');
 const keyId=createHash('sha256').update(der).digest('hex'),trust={keyId,publicKeySpkiBase64:der.toString('base64'),signatureAlgorithm:'Ed25519',trustDomain:'agenttrust-local-development',productionKey:false};
 return verifiedGateCheck(frame,trust,user,record,archive,challenge,started,now);
}
