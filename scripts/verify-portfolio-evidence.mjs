import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {readPortfolioEvidence} from './portfolio-evidence.mjs';

try{
  const args=process.argv.slice(2);
  if(![2,3].includes(args.length)||args.some(value=>!value.trim())||args[2]!==undefined&&!/^[a-f0-9]{64}$/.test(args[2]))throw Error('Invalid verification input');
  const trustedPem=await readTrustedReceiptKey(args[1]);
  console.log(JSON.stringify(await readPortfolioEvidence(args[0],trustedPem,args[2])));
}catch{
  console.error('Portfolio evidence verification failed. Supply an unmodified bundle, an independently trusted public key, and the expected manifest SHA-256 when available.');
  process.exitCode=2;
}
