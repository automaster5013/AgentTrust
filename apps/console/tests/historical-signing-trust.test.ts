import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptTrustPath} from '../src/lib/receipt-contracts.ts';
import {proxyPath} from '../src/lib/proxy-policy.ts';

test('historical trust lookup uses the receipt key rather than the currently active signing key',()=>{
 const old='a'.repeat(64),active='b'.repeat(64);
 assert.equal(receiptTrustPath({keyId:old}),'gate-trust/keys/'+old);
 assert.notEqual(receiptTrustPath({keyId:old}),'gate-trust/keys/'+active);
 assert.equal(proxyPath(receiptTrustPath({keyId:old}).split('/'),'GET'),'/api/gate-trust/keys/'+old);
});
test('untrusted receipt cannot inject a URL path or request an unbounded key identifier',()=>{
 for(const value of [null,[],{}, {keyId:null},{keyId:1},{keyId:'a'.repeat(63)},{keyId:'a'.repeat(65)},{keyId:'A'.repeat(64)}, {keyId:'../gate-trust'},{keyId:'https://other.example/key'},{keyId:'a'.repeat(64)+'/extra'}])assert.throws(()=>receiptTrustPath(value));
});
test('historical public key route is bounded and read only through the console proxy',()=>{
 const path=['gate-trust','keys','a'.repeat(64)];
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.throws(()=>proxyPath(path,method));
 for(const tail of ['a'.repeat(63),'a'.repeat(65),'a'.repeat(64)+'%2fother','../current'])assert.throws(()=>proxyPath(['gate-trust','keys',tail],'GET'));
 assert.throws(()=>proxyPath([...path,'extra'],'GET'));
});
