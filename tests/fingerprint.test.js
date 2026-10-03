import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintRows } from '../packages/backup/fingerprint.js';
import { hash } from '../packages/contracts/hash.js';

test('streamed fingerprints preserve historical canonical hashes',async()=>{
  for(const rows of [[],[null], [{z:'한국어',a:{b:2,a:[false,null,'🙂']}},{id:1}]]){
    assert.deepEqual(await fingerprintRows(rows),{count:rows.length,hash:hash(rows)});
  }
  const rows=Array.from({length:10000},(_,id)=>({id,nested:{z:id%7,a:'row'}}));
  async function* batches(){for(const row of rows)yield row;}
  assert.deepEqual(await fingerprintRows(batches()),{count:rows.length,hash:hash(rows)});
});
