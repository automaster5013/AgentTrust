import {writeFile,realpath} from 'node:fs/promises';
import {extname,dirname,relative,isAbsolute,sep} from 'node:path';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {createPortfolioEvidenceReport} from './portfolio-evidence-report.mjs';
try{
 const args=process.argv.slice(2);
 if(![3,4].includes(args.length)||args.some(value=>!value.trim())||extname(args[2]).toLowerCase()!=='.html'||args[3]!==undefined&&!/^[a-f0-9]{64}$/.test(args[3]))throw Error('Invalid report input');
 const destination=relative(await realpath(args[0]),await realpath(dirname(args[2])));
 if(!(isAbsolute(destination)||destination==='..'||destination.startsWith('..'+sep)))throw Error('Report must be outside the immutable bundle');
 const trustedPem=await readTrustedReceiptKey(args[1]);
 const report=await createPortfolioEvidenceReport(args[0],trustedPem,args[3]);
 await writeFile(args[2],report.html,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({reportCreated:true,format:'html',...report.verification,reportCryptographicallySigned:false}));
}catch{
 console.error('Audit report was not created. Supply a verified bundle, an independently trusted public key and a new .html output path.');process.exitCode=2;
}
