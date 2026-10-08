import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {hash} from '../packages/contracts/hash.js';
import {verifySameSchemaRollback} from '../scripts/rollback-schema.mjs';
import {rollbackInputs} from '../scripts/rollback-preflight.mjs';
const sources=[{name:'001_initial.sql',sql:'CREATE TABLE sample(id integer);\n'},{name:'002_index.sql',sql:'CREATE INDEX sample_id ON sample(id);\n'}];
const rows=sources.map(s=>({name:s.name,checksum:hash(s.sql.trimEnd())}));
const env={AGENTTRUST_IMAGE:'ghcr.io/automaster5013/agenttrust@sha256:'+'a'.repeat(64),AGENTTRUST_EXPECTED_REVISION:'a'.repeat(40),AGENTTRUST_ROLLBACK_IMAGE:'ghcr.io/automaster5013/agenttrust@sha256:'+'b'.repeat(64),AGENTTRUST_ROLLBACK_REVISION:'b'.repeat(40)};
test('same schema rollback accepts reordered matching sources and normalized line endings without rewriting inputs',()=>{
 const before=JSON.stringify({rows,sources}),previous=structuredClone(sources).reverse().map(s=>({...s,sql:'\uFEFF'+s.sql.replaceAll('\n','\r\n')+'\r\n'})),report=verifySameSchemaRollback(rows,sources,previous);assert.equal(report.migrationCount,2);assert.equal(report.sameMigrationSourcesVerified,true);assert.equal(report.bothRevisionLedgersVerified,true);assert.equal(report.dataSemanticCompatibilityVerified,false);assert.equal(report.rollbackExecutionVerified,false);assert.equal(report.schemaDowngradePerformed,false);assert.equal(JSON.stringify({rows,sources}),before);
});
test('changed, extra, absent or duplicate migration sources cannot produce a rollback plan',()=>{
 for(const previous of [sources.slice(1),[...sources,{name:'003_new.sql',sql:'SELECT 1;'}],[sources[0],{...sources[1],sql:'DROP TABLE sample;'}],[sources[0],sources[0]]])assert.throws(()=>verifySameSchemaRollback(rows,sources,previous));
 for(const ledger of [rows.slice(1),[rows[0],rows[0]],rows.map(s=>({...s,checksum:'0'.repeat(64)}))])assert.throws(()=>verifySameSchemaRollback(ledger,sources,sources));
});
test('rollback identity inputs require distinct immutable digests and distinct full revisions before external work',()=>{
 assert.equal(rollbackInputs(env).maxAgeHours,24);
 for(const changes of [{AGENTTRUST_IMAGE:'ghcr.io/automaster5013/agenttrust:main'},{AGENTTRUST_ROLLBACK_IMAGE:env.AGENTTRUST_IMAGE},{AGENTTRUST_ROLLBACK_REVISION:env.AGENTTRUST_EXPECTED_REVISION},{AGENTTRUST_ROLLBACK_REVISION:'HEAD~1'},{AGENTTRUST_ROLLBACK_IMAGE:'ghcr.io/foreign/agenttrust@sha256:'+'c'.repeat(64)},{AGENTTRUST_BACKUP_MAX_AGE_HOURS:'0'},{AGENTTRUST_BACKUP_MAX_AGE_HOURS:'169'}])assert.throws(()=>rollbackInputs({...env,...changes}));
});
test('actual rollback preflight CLI refuses malformed secret-bearing inputs and extra arguments without raw diagnostics',()=>{
 for(const args of [[],['--execute']]){const r=spawnSync(process.execPath,['scripts/rollback-preflight.mjs',...args],{cwd:process.cwd(),env:{...process.env,...env,AGENTTRUST_IMAGE:'secret://private-password@private-host'},encoding:'utf8',windowsHide:true});assert.equal(r.status,1);const report=JSON.parse(r.stdout);assert.equal(report.status,'blocked');assert.equal(report.readOnly,true);assert.equal(report.serverDeployed,false);assert.doesNotMatch(r.stdout+r.stderr,/private-password|private-host|secret:\/\//);}
});
