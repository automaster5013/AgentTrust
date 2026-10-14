import {boundedUtf8} from './bounded-utf8.ts';
export const uncertainEvaluationWrite='평가 요청의 저장 결과를 확인하지 못했습니다. 서버에서 처리됐을 수 있으므로 평가 목록·근거·검토 이력·현재 게이트를 확인한 뒤 다시 제출해 주세요.';
export class EvaluationHttpError extends Error{
 readonly status:number;
 constructor(status:number){super(status===401?'로그인이 필요합니다.':status===403?'권한 또는 요청 검증을 확인해 주세요.':'요청을 완료하지 못했습니다.');this.status=status}
}
export class EvaluationWriteUncertainError extends Error{constructor(){super(uncertainEvaluationWrite)}}
export async function evaluationJson(path:string,init?:RequestInit):Promise<unknown>{
 const write=init?.method==='POST'&&(path==='runs'||/^runs\/[a-f0-9-]{36}\/(reviews|cancel)$/.test(path));
 const signal=AbortSignal.any([AbortSignal.timeout(10000),...(init?.signal?[init.signal]:[])]);
 try{
  const response=await fetch('/backend/'+path,{...init,cache:'no-store',signal});
  if(!response.ok){void response.body?.cancel().catch(()=>{});if(write&&![400,401,403,404,409,413,422,429].includes(response.status))throw new EvaluationWriteUncertainError();throw new EvaluationHttpError(response.status)}
  return JSON.parse(await boundedUtf8(response.body,1048576,signal)) as unknown;
 }catch(error){
  if(write&&!(error instanceof EvaluationHttpError))throw new EvaluationWriteUncertainError();
  throw error instanceof EvaluationHttpError?error:Error('요청을 완료하지 못했습니다.');
 }
}
export function evaluationWriteNotice(error:unknown,writeStarted:boolean,receiptVerified:boolean,fallback:string):string{
 if(writeStarted&&!receiptVerified&&!(error instanceof EvaluationHttpError))return uncertainEvaluationWrite;
 return error instanceof EvaluationHttpError?error.message:fallback;
}
