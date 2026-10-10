/** Offline Ed25519 verification against a separately supplied development public key. */
import {readFileSync,statSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createPublicKey,createHash} from 'node:crypto';
import {verifiedCampaign,verifiedCampaignArchive} from '../apps/console/src/lib/campaign-contracts.ts';
import {verifiedReceipt} from '../apps/console/src/lib/receipt-contracts.ts';
import {type Identity} from '../apps/console/src/lib/contracts.ts';
function uuid(value:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('INVALID_SCOPE');return value}
try{
 const args=process.argv.slice(2),allowed=new Set(['--bundle','--trusted-public-key','--organization','--project','--campaign']),options=new Map<string,string>();
 if(args.length!==10)throw Error('INVALID_ARGUMENTS');for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||options.has(args[i])||!args[i+1])throw Error('INVALID_ARGUMENTS');options.set(args[i],args[i+1])}
 const folder=realpathSync(resolve(options.get('--bundle')!));function read(name:string){const path=realpathSync(join(folder,name)),inside=relative(folder,path);if(isAbsolute(inside)||inside.startsWith('..')||!statSync(path).isFile()||statSync(path).size>50000)throw Error('INVALID_BUNDLE');return JSON.parse(readFileSync(path,'utf8')) as unknown}
 const publicPath=realpathSync(resolve(options.get('--trusted-public-key')!));if(!statSync(publicPath).isFile()||statSync(publicPath).size>4096)throw Error('INVALID_TRUST_ANCHOR');const publicKey=createPublicKey(readFileSync(publicPath));if(publicKey.asymmetricKeyType!=='ed25519')throw Error('INVALID_TRUST_ANCHOR');const der=publicKey.export({type:'spki',format:'der'}),keyId=createHash('sha256').update(der).digest('hex');
 const user:Identity={username:'offline-verifier',actorId:'00000000-0000-4000-8000-000000000000',organizationId:uuid(options.get('--organization')!),projectId:uuid(options.get('--project')!),role:'viewer',identityProvider:'keycloak',runtime:'java21-spring-boot'},campaignId=uuid(options.get('--campaign')!);
 const record=await verifiedCampaign(read('campaign.json'),user,campaignId),archive=await verifiedCampaignArchive(read('parent.json'),user,record),receipt=await verifiedReceipt(read('receipt.json'),{keyId,publicKeySpkiBase64:der.toString('base64'),signatureAlgorithm:'Ed25519',trustDomain:'agenttrust-local-development',productionKey:false},user,record,archive);
 process.stdout.write(JSON.stringify({completed:true,signatureVerified:true,trustedKeyId:keyId,receiptId:receipt.receiptId,campaignId,trustDomain:'agenttrust-local-development',currentDeploymentAuthority:false,childBytesVerified:false,networkUsed:false})+'\n');
}catch{process.stdout.write(JSON.stringify({completed:false,code:'SIGNED_OBSERVATION_UNVERIFIED',currentDeploymentAuthority:false})+'\n');process.exitCode=1}
