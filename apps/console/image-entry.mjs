import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('./oidc-image-config.json',import.meta.url),'utf8'));
for(const [name,key] of [['NEXT_PUBLIC_STACK_OIDC_PROFILE','profile'],['NEXT_PUBLIC_STACK_APPLICATION_ORIGIN','applicationOrigin'],['NEXT_PUBLIC_STACK_PUBLIC_ISSUER','publicIssuer']]){
  if(process.env[name]!==undefined&&process.env[name]!==config[key]){
    console.error('OIDC_IMAGE_CONFIGURATION_MISMATCH');process.exit(1);
  }
  process.env[name]=config[key];
}
await import('./server.js');
