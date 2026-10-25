import type {Gate} from './contracts';
export type ReleaseObservation=Pick<Gate,'decision'|'deploymentAllowed'|'policyStatus'>;
export function releasePresentation(gate:ReleaseObservation|null):'allowed'|'blocked'|'unavailable'{
 if(!gate||gate.policyStatus!=='evaluated')return 'unavailable';
 return gate.deploymentAllowed&&gate.decision==='pass'?'allowed':'blocked';
}

export function evaluationNextAction(decision:Gate['decision'],gate:ReleaseObservation|null):string{
 if(decision==='block')return '실패한 필수 규칙과 근거를 확인하고 입력 또는 에이전트를 수정한 뒤 새 평가를 실행하세요.';
 if(decision==='inconclusive')return '누락된 근거와 실행 상태를 확인하세요. 진행 중이면 완료를 기다리고, 종료된 오류라면 원인을 해결한 뒤 새 평가를 실행하세요.';
 const release=releasePresentation(gate);
 if(release==='unavailable')return '현재 게이트를 다시 조회하세요. 평가 통과만으로 릴리스가 허용되지 않습니다.';
 if(release==='blocked')return '현재 게이트의 차단 사유와 검토 이력을 확인하세요. 필요한 관리자 검토 또는 근거 조건을 충족한 뒤 다시 조회하세요.';
 return '릴리스 직전에 현재 게이트를 다시 확인하세요. 이 화면은 실제 배포를 실행하지 않습니다.';
}
