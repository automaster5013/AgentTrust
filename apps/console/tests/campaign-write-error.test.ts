import test from 'node:test';import assert from 'node:assert/strict';
import {campaignWriteError,uncertainCampaignWrite} from '../src/lib/campaign-write-error.ts';
test('interrupted writes are uncertain and direct the operator to inspect before resubmission',()=>{
 for(const error of [new DOMException('fixture','TimeoutError'),new DOMException('fixture','AbortError'),new TypeError('fixture-network'),new SyntaxError('fixture-private-response')])assert.equal(campaignWriteError(error).message,uncertainCampaignWrite);
});
test('known HTTP refusals preserve their existing safe explanation',()=>{
 const refusal=Error('프로젝트 요청·저장 한도에 도달했습니다.');assert.equal(campaignWriteError(refusal),refusal);assert.equal(campaignWriteError(null).message,'캠페인 요청을 확인하지 못했습니다.');
});
