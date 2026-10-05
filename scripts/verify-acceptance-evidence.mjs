import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {readAcceptanceEvidence} from './acceptance-evidence.mjs';
try{const args=process.argv.slice(2);if(args.length!==3||args.some(value=>!value.trim())||!/^[a-f0-9]{64}$/.test(args[2]))throw Error('Invalid verification options');const trustedPem=await readTrustedReceiptKey(args[1]);console.log(JSON.stringify(await readAcceptanceEvidence(args[0],trustedPem,args[2])));}
catch{console.log(JSON.stringify({schemaVersion:1,purpose:'synthetic-acceptance-evidence-verification',status:'blocked',historicalEvidenceOnly:true,currentReleasePermissionVerified:false,serverDeployed:false}));process.exitCode=2;}
