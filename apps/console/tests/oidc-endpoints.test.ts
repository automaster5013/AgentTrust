import test from 'node:test';
import assert from 'node:assert/strict';
import {oidcEndpoints,oidcLogoutUrl,allowedPublicHost,validateSessionCookie} from '../src/lib/oidc-endpoints.ts';
import {oauthQuery,oidcRedirect,sameOrigin} from '../src/lib/proxy-policy.ts';

test('local OIDC endpoints preserve login, callback, logout and host allowlist',()=>{
  const e=oidcEndpoints();assert.equal(e.applicationOrigin,'http://127.0.0.1:4320');
  assert.ok(allowedPublicHost('127.0.0.1:4320',e));assert.ok(allowedPublicHost('localhost:4320',e));
  assert.equal(allowedPublicHost('evil.example.com',e),false);
  assert.equal(oidcRedirect('/login/oauth2/code/keycloak','http://127.0.0.1:4320/',e),'http://127.0.0.1:4320/');
  assert.ok(oidcLogoutUrl(e).endsWith('http%3A%2F%2F127.0.0.1%3A4320%2F'));
});
test('HTTPS endpoints pin host, exact callback issuer, auth redirect and logout origin',()=>{
  const e=oidcEndpoints('https-review','https://console.example.com','https://identity.example.com/realms/agenttrust');
  assert.ok(allowedPublicHost('console.example.com',e));assert.equal(allowedPublicHost('localhost:4320',e),false);
  const q=new URLSearchParams({code:'abcdefgh',state:'12345678',iss:e.publicIssuer});assert.ok(oauthQuery('/login/oauth2/code/keycloak',q,e));
  q.set('iss','https://identity.example.com/realms/other');assert.throws(()=>oauthQuery('/login/oauth2/code/keycloak',q,e));
  const login=e.publicIssuer+'/protocol/openid-connect/auth?state=12345678';assert.equal(oidcRedirect('/oauth2/authorization/keycloak',login,e),login);
  assert.throws(()=>oidcRedirect('/oauth2/authorization/keycloak','https://evil.example.com/realms/agenttrust/protocol/openid-connect/auth',e));
  assert.throws(()=>oidcRedirect('/login/oauth2/code/keycloak','https://console.example.com/?next=evil',e));
  assert.equal(oidcLogoutUrl(e),'https://identity.example.com/realms/agenttrust/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri=https%3A%2F%2Fconsole.example.com%2F');
});
test('HTTPS configuration rejects ambiguous origins before redirect processing',()=>{
  for(const origin of ['http://console.example.com','https://console.example.com/','https://console.example.com:443','https://user@console.example.com','https://console.example.com?x=1','https://console.example.com#x','https://127.0.0.1','https://[::1]','https://console.local','https://console.internal','https://console.localhost','https://*.example.com','https://CONSOLE.example.com','https://console.example.com\\evil','https://console.example.com\n','https://console.example.com/%2f','https://console%2eexample.com'])
    assert.throws(()=>oidcEndpoints('https-review',origin,'https://identity.example.com/realms/agenttrust'),/INVALID_OIDC_CONFIGURATION/);
  for(const issuer of ['https://identity.example.com','https://identity.example.com/realms/other','https://identity.example.com/realms/agenttrust/','https://identity.example.com/realms/%61genttrust'])
    assert.throws(()=>oidcEndpoints('https-review','https://console.example.com',issuer));
  assert.throws(()=>oidcEndpoints('production'));assert.throws(()=>oidcEndpoints('local-review','https://console.example.com'));
});
test('HTTPS refuses insecure session cookies and ambiguous request Origin headers',()=>{
  const e=oidcEndpoints('https-review','https://console.example.com','https://identity.example.com/realms/agenttrust');
  assert.doesNotThrow(()=>validateSessionCookie('AGENTTRUST_STACK_SESSION=fixture; Path=/; Secure; HttpOnly; SameSite=Lax',e));
  for(const suffix of ['; HttpOnly','; Secure','; NotSecure; NotHttpOnly'])assert.throws(()=>validateSessionCookie('AGENTTRUST_STACK_SESSION=fixture'+suffix,e));
  for(const origin of ['https://user@console.example.com','https://console.example.com/','https://console.example.com#fragment','https://console.example.com:443','http://console.example.com'])assert.equal(sameOrigin(origin,e.applicationOrigin),false);
  assert.equal(sameOrigin(e.applicationOrigin,e.applicationOrigin),true);
});
