import test from 'node:test';import assert from 'node:assert/strict';
import {gateCheckRemaining} from '../src/lib/gate-check-lifetime.ts';
import type {GateCheck} from '../src/lib/gate-check-contracts.ts';
const start=2_000_000_000_000;const check=(duration:number)=>({checkedAtEpochMillis:start,expiresAtEpochMillis:start+duration}) as GateCheck;
test('short signed approval expiry cannot be extended by a backward wall clock',()=>{assert.equal(gateCheckRemaining(check(1000),start-500,100,1100),0);assert.equal(gateCheckRemaining(check(1000),start-500,100,600),500);assert.equal(gateCheckRemaining(check(30000),start-60000,100,30100),0)});
test('request and verification elapsed time consume signed lifetime and future wall clocks expire it',()=>{assert.equal(gateCheckRemaining(check(30000),start+50,100,1100),29000);assert.equal(gateCheckRemaining(check(1000),start+1000,100,200),0);assert.equal(gateCheckRemaining(check(1000),start+750,100,300),250)});
test('nonfinite reversed monotonic clocks and impossible signed lifetimes fail closed',()=>{for(const [value,wall,began,now] of [[check(30001),start,0,1],[check(0),start,0,1],[check(1000),Infinity,0,1],[check(1000),start,-1,1],[check(1000),start,2,1],[check(1000),start,0,NaN]] as const)assert.throws(()=>gateCheckRemaining(value,wall,began,now))});
