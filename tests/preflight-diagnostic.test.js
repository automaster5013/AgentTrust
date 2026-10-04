import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {preflightDiagnostic} from '../scripts/preflight-diagnostic.mjs';

test('blocked diagnostics preserve completed checks and never mark later checks passed',()=>{
  const report=preflightDiagnostic('database-target');
  assert.equal(report.status,'blocked');assert.equal(report.code,'PREFLIGHT_DATABASE_TARGET');
  assert.deepEqual(report.checks.map(c=>c.status),['passed','passed','passed','passed','blocked','not_run','not_run']);
  assert.equal(preflightDiagnostic().checks.every(c=>c.status==='passed'),true);
  const canary='secret-password-do-not-print';const unknown=preflightDiagnostic(canary);
  assert.equal(unknown.failedCheck,'inputs');assert.ok(!JSON.stringify(unknown).includes(canary));
});
test('real preflight CLI rejects secret-bearing malformed input with safe JSON and nonzero exit',()=>{
  const canary='secret-password-do-not-print';
  const result=spawnSync(process.execPath,['scripts/deploy-preflight.mjs'],{encoding:'utf8',timeout:15000,env:{...process.env,AGENTTRUST_IMAGE:'postgres://user:'+canary+'@host/db',AGENTTRUST_EXPECTED_REVISION:'a'.repeat(40)}});
  assert.equal(result.status,1);assert.equal(result.error,undefined);
  assert.ok(!result.stdout.includes(canary));assert.ok(!result.stderr.includes(canary));
  const report=JSON.parse(result.stdout);assert.equal(report.failedCheck,'inputs');assert.equal(report.code,'PREFLIGHT_INPUTS');
  assert.equal(report.checks.slice(1).every(c=>c.status==='not_run'),true);
  assert.ok(!/AssertionError|stack|postgres:\/\//.test(result.stdout+result.stderr));
});
test('invalid backup age is rejected before Compose or registry inspection',()=>{
  const result=spawnSync(process.execPath,['scripts/deploy-preflight.mjs'],{encoding:'utf8',timeout:15000,env:{...process.env,AGENTTRUST_IMAGE:'ghcr.io/example/agenttrust@sha256:'+'a'.repeat(64),AGENTTRUST_EXPECTED_REVISION:'b'.repeat(40),AGENTTRUST_BACKUP_MAX_AGE_HOURS:'169'}});
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).failedCheck,'inputs');
});
