import test from 'node:test';
import assert from 'node:assert/strict';
import {backchannelPath,backchannelForm,backchannelHostAllowed,backchannelResponse} from '../src/lib/backchannel.ts';
import {proxyPath} from '../src/lib/proxy-policy.ts';
import {oidcEndpoints} from '../src/lib/oidc-endpoints.ts';

test('only the exact POST receiver is routed; encoded slashes or alternate segments cannot select a backend',()=>{
 const segments=['logout','connect','back-channel','keycloak'];assert.equal(proxyPath(segments,'POST'),backchannelPath);
 for(const method of ['GET','PUT','DELETE'])assert.throws(()=>proxyPath(segments,method));
 for(const value of [['logout/connect','back-channel','keycloak'],['logout','connect','back-channel','other'],['logout%2fconnect','back-channel','keycloak'],[...segments,'extra']])assert.throws(()=>proxyPath(value,'POST'));
});
test('one bounded form token is normalized but syntax does not claim signed authenticity',()=>{
 assert.equal(backchannelForm('logout_token=aa.bb.cc','application/x-www-form-urlencoded'),'logout_token=aa.bb.cc');
 assert.equal(backchannelForm('logout%5Ftoken=aa%2Ebb%2Ecc','application/x-www-form-urlencoded; charset=UTF-8'),'logout_token=aa.bb.cc');
 assert.throws(()=>backchannelForm('?logout_token=aa.bb.cc','application/x-www-form-urlencoded'));
 for(const value of ['logout_token=aa.bb.cc&logout_token=dd.ee.ff','logout_token=aa.bb.cc&scope=other','id_token=aa.bb.cc','logout_token=aa.bb.cc&','logout_token=aa.bb.cc%0A','logout_token=aa.%FF.cc','logout_token='+('a'.repeat(2049))+'.b.c','logout_token=a.'+'b'.repeat(12289)+'.c','logout_token=a.b.'+'c'.repeat(2049),'x'.repeat(16385)])assert.throws(()=>backchannelForm(value,'application/x-www-form-urlencoded'));
 for(const type of [null,'application/json','multipart/form-data','application/x-www-form-urlencoded;charset=iso-8859-1','application/x-www-form-urlencoded; charset=utf-8; charset=utf-8'])assert.throws(()=>backchannelForm('logout_token=aa.bb.cc',type));
});
test('internal fixture Host is confined to local review; HTTPS receiver retains its exact configured public Host',()=>{
 const local=oidcEndpoints('local-review','http://127.0.0.1:4320','http://127.0.0.1:4322/realms/agenttrust'),remote=oidcEndpoints('https-review','https://app.agenttrust.test','https://identity.agenttrust.test/realms/agenttrust');
 assert.equal(backchannelHostAllowed('stack-console:3000',local),true);assert.equal(backchannelHostAllowed('127.0.0.1:4320',local),true);
 assert.equal(backchannelHostAllowed('stack-console:3000',remote),false);assert.equal(backchannelHostAllowed('app.agenttrust.test',remote),true);
 for(const host of [null,'attacker.example','app.agenttrust.test.evil','app.agenttrust.test:8443'])assert.equal(backchannelHostAllowed(host,remote),false);
});
test('receiver response never reflects upstream body, redirects, cookies or an unbounded retry hint',async()=>{
 for(const status of [200,204,400,401,429,503,302,500]){const response=backchannelResponse(status,'60');assert.equal(response.status,[200,204,400,401,429,503].includes(status)?status:502);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('location'),null);if(status!==204)assert.equal((await response.json()).code,status===200?'LOGOUT_PROCESSED':'LOGOUT_REFUSED')}
 assert.equal(backchannelResponse(429,'60').headers.get('retry-after'),'60');assert.equal(backchannelResponse(429,'not-a-number').headers.get('retry-after'),null);
});
