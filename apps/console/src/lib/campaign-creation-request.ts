import {boundedUtf8} from './bounded-utf8.ts';
import {uncertainCampaignWrite} from './campaign-write-error.ts';
export class CampaignCreationHttpError extends Error{
 readonly status:number;
 constructor(status:number){super(status===401?'로그인이 필요합니다.':status===403?'권한 또는 요청 검증을 확인해 주세요.':'캠페인 요청을 완료하지 못했습니다.');this.status=status}
}
export class CampaignCreationUncertainError extends Error{constructor(){super(uncertainCampaignWrite)}}
export async function campaignCreationJson(path:string,init?:RequestInit):Promise<unknown>{
 const write=init?.method==='POST'&&path==='campaigns',signal=AbortSignal.any([AbortSignal.timeout(10000),...(init?.signal?[init.signal]:[])]);
 try{
  const response=await fetch('/backend/'+path,{...init,cache:'no-store',signal});
  if(!response.ok){void response.body?.cancel().catch(()=>{});if(write&&![400,401,403,404,409,413,422,429].includes(response.status))throw new CampaignCreationUncertainError();throw new CampaignCreationHttpError(response.status)}
  return JSON.parse(await boundedUtf8(response.body,1048576,signal)) as unknown;
 }catch(error){if(write&&!(error instanceof CampaignCreationHttpError))throw new CampaignCreationUncertainError();throw error instanceof CampaignCreationHttpError?error:Error('캠페인 요청을 완료하지 못했습니다.')}
}
