export const uncertainCampaignWrite='저장 결과를 확인하지 못했습니다. 서버에서 처리됐을 수 있으므로 캠페인·버전 목록이나 현재 게이트를 확인한 뒤 다시 제출해 주세요.';
export function campaignWriteError(error:unknown):Error {
 if(error instanceof Error&&['TimeoutError','AbortError','TypeError','SyntaxError'].includes(error.name))return Error(uncertainCampaignWrite);
 return error instanceof Error?error:Error('캠페인 요청을 확인하지 못했습니다.');
}
export function campaignWriteNotice(error:unknown,fallback:string):string {
 return error instanceof Error&&error.message===uncertainCampaignWrite?uncertainCampaignWrite:fallback;
}
