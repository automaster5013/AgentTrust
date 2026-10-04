import assert from 'node:assert/strict';

// Compare bounded list metadata with the six artifacts already verified offline.
// This phase reads history only; it cannot reuse historical approval as permission.
export async function verifyPortfolioReceiptHistory({call,receipts}){
  assert.ok(Array.isArray(receipts)&&receipts.length===6);
  const candidates=[...new Set(receipts.map(receipt=>receipt.artifact.request.candidateRunId))];assert.equal(candidates.length,4);
  let queries=0;
  for(const candidateRunId of candidates)for(const decision of ['', 'pass','block']){
    const expected=new Map(receipts.filter(receipt=>receipt.artifact.request.candidateRunId===candidateRunId&&(!decision||receipt.artifact.result.decision===decision)).map(receipt=>[receipt.artifact.receiptId,receipt]));
    const seen=new Set();let cursor=null,pages=0;
    do{
      assert.ok(++pages<=Math.max(1,expected.size));
      const params=new URLSearchParams({limit:'1',candidateRunId});if(decision)params.set('decision',decision);if(cursor)params.set('cursor',cursor);
      const page=await call('/v1/release-receipts?'+params.toString());queries++;
      assert.ok(Array.isArray(page?.items)&&page.items.length<=1);assert.ok(page.nextCursor===null||typeof page.nextCursor==='string'&&page.nextCursor.length<=512&&/^[A-Za-z0-9_-]+$/.test(page.nextCursor));
      for(const row of page.items){
        const receipt=expected.get(row.id);assert.ok(receipt&&!seen.has(row.id));seen.add(row.id);
        const artifact=receipt.artifact;assert.equal(row.candidate_run_id,candidateRunId);assert.equal(row.baseline_run_id??null,artifact.request.baselineRunId??null);
        assert.equal(row.decision,artifact.result.decision);assert.equal(row.artifact_hash,receipt.artifactHash);assert.equal(row.signing_key_id,receipt.signature.keyId);
        assert.equal(Date.parse(row.created_at),Date.parse(artifact.checkedAt));
        for(const key of ['artifact','request','result','evidence','snapshot','signature'])assert.equal(Object.hasOwn(row,key),false);
      }
      cursor=page.nextCursor;
    }while(cursor);
    assert.equal(seen.size,expected.size);
  }
  return {receiptHistoryVerified:true,receiptHistoryCandidates:4,receiptHistoryRecordsMatched:6,receiptHistoryQueries:queries,readOnlyHistoryQueries:true};
}
