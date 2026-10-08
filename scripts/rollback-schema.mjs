import assert from 'node:assert/strict';
import {hash} from '../packages/contracts/hash.js';
import {verifyMigrationLedger} from './deployment-schema.mjs';

const canonical=sql=>sql.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trimEnd();
export function verifySameSchemaRollback(rows,currentSources,previousSources){
 const current=verifyMigrationLedger(rows,currentSources),previous=verifyMigrationLedger(rows,previousSources);
 assert.equal(current.migrationHash,previous.migrationHash);
 const currentByName=new Map(currentSources.map(row=>[row.name,canonical(row.sql)]));
 assert.equal(currentByName.size,previousSources.length);
 for(const source of previousSources)assert.equal(currentByName.get(source.name),canonical(source.sql));
 return {sameMigrationSourcesVerified:true,bothRevisionLedgersVerified:true,migrationCount:current.migrationCount,migrationHash:current.migrationHash,migrationSourceHash:hash([...currentByName].sort(([a],[b])=>a.localeCompare(b,'en'))),schemaDowngradePerformed:false,dataSemanticCompatibilityVerified:false,rollbackExecutionVerified:false};
}
