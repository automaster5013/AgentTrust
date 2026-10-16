import assert from 'node:assert/strict';
import test from 'node:test';
import {fixturePath} from './stack_https_fixture_edge_policy.mjs';
test('real fixed OIDC paths and encoded callback query stay inside their realm',()=>{
 for(const [host,path] of [['console.example.com','/backend/login/oauth2/code/keycloak?code=PUBLIC&state=PUBLIC'],
  ['identity.example.com','/realms/agenttrust/protocol/openid-connect/auth?redirect_uri=https%3A%2F%2Fconsole.example.com%2Fbackend%2Flogin%2Foauth2%2Fcode%2Fkeycloak'],
  ['enterprise.example.net','/realms/enterprise-synthetic/protocol/openid-connect/auth'],
  ['identity.example.com','/resources/abc/login/keycloak.v2/index.js']]){
  assert.equal(fixturePath(host,path),path.split('?',1)[0]);
 }
});
test('literal, encoded and doubly encoded realm escapes are refused',()=>{
 for(const path of ['/realms/agenttrust/../master/protocol/openid-connect/token',
  '/realms/agenttrust/%2e%2e/master/protocol/openid-connect/token',
  '/realms/agenttrust/.%2e/master/protocol/openid-connect/token',
  '/realms/agenttrust/%2f../master/protocol/openid-connect/token',
  '/realms/agenttrust/%252e%252e/master/protocol/openid-connect/token',
  '/realms/agenttrust/%5c..%5cmaster/protocol/openid-connect/token',
  '/realms/agenttrust/auth%00', '/realms/agenttrust/auth#fragment',
  '//evil.invalid/realms/agenttrust/', '/admin/realms/agenttrust', '/realms/master/token',
  '/realms/agenttrust/auth\r\nX:unsafe', '/realms/agenttrust/auth\\unsafe']){
  assert.equal(fixturePath('identity.example.com',path),null);
 }
 assert.equal(fixturePath('enterprise.example.net','/realms/agenttrust/'),null);
 assert.equal(fixturePath('identity.example.com','/realms/enterprise-synthetic/'),null);
});
test('host parsing cannot choose another fixture origin or upstream',()=>{
 for(const host of ['identity.example.com:443','IDENTITY.example.com','identity.example.com.','identity.example.com.evil.invalid','user@identity.example.com','tls-identity']){
  assert.equal(fixturePath(host,'/realms/agenttrust/'),null);
 }
});
