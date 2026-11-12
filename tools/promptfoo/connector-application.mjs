import Ajv from 'ajv';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifierServer} from './quality-server.mjs';
import {connectorServer} from './connector-server.mjs';
import {AJV_VERSION} from './connector-policy.mjs';
if(JSON.parse(readFileSync(new URL('./node_modules/ajv/package.json',import.meta.url),'utf8')).version!==AJV_VERSION)throw Error('VERIFIER_VERSION_DIFFERS');
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const token=readFileSync('/run/secrets/stack-worker-token','utf8');connectorServer(token,Ajv,verifierServer(token)).listen(9105,'0.0.0.0');
}
