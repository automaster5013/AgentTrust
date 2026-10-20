import test from 'node:test';
import assert from 'node:assert/strict';
import {releasePresentation} from '../src/lib/release-presentation.ts';
test('evaluation pass alone never displays release permission',()=>{assert.equal(releasePresentation(null),'unavailable');assert.equal(releasePresentation({decision:'pass',deploymentAllowed:false,policyStatus:'evaluated'}),'blocked')});
test('missing policy observation overrides even a positive permission flag',()=>{for(const decision of ['pass','block','inconclusive'] as const)assert.equal(releasePresentation({decision,deploymentAllowed:true,policyStatus:'unavailable'}),'unavailable')});
test('failed and inconclusive evaluations cannot display permission',()=>{for(const decision of ['block','inconclusive'] as const)for(const deploymentAllowed of [true,false])assert.equal(releasePresentation({decision,deploymentAllowed,policyStatus:'evaluated'}),'blocked')});
test('only an evaluated pass and explicit gate permission display allowed',()=>{assert.equal(releasePresentation({decision:'pass',deploymentAllowed:true,policyStatus:'evaluated'}),'allowed')});
