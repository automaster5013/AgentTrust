import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readTrustedReceiptKey,trustedKeyFileLimit} from '../scripts/trusted-receipt-key.mjs';
test('trusted key reader enforces exact file limit, strict encoding and a single public key',async t=>{
 const root=resolve('.local'),dir=await mkdtemp(join(root,'trusted-key-test-'));assert.ok(dir.startsWith(root+(process.platform==='win32'?'\\':'/')));t.after(()=>rm(dir,{recursive:true,force:true}));
 const key=join(dir,'public.pem'),pair=generateKeyPairSync('ed25519'),pem=pair.publicKey.export({type:'spki',format:'pem'});
 const atLimit=pem+' '.repeat(trustedKeyFileLimit-Buffer.byteLength(pem));await writeFile(key,atLimit);assert.equal(await readTrustedReceiptKey(key),atLimit);
 for(const invalid of [atLimit+' ',Buffer.concat([Buffer.from(pem),Buffer.from([255])]),pem+pem,pem+pair.privateKey.export({type:'pkcs8',format:'pem'}),'']){await writeFile(key,invalid);await assert.rejects(readTrustedReceiptKey(key));}
 await assert.rejects(readTrustedReceiptKey(dir));await assert.rejects(readTrustedReceiptKey(join(dir,'missing.pem')));
 await writeFile(key,pem.replaceAll('\n','\r\n'));assert.equal(await readTrustedReceiptKey(key),pem.replaceAll('\n','\r\n'));
});
