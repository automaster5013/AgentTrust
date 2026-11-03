import type {Run} from '../lib/contracts';
import {evaluationNextAction,releasePresentation,type ReleaseObservation} from '../lib/release-presentation';
const labels={pass:'통과',block:'차단',inconclusive:'판정 보류'};
export default function DecisionSummary({decision,gate,label='평가와 릴리스 구분'}:{decision:Run['decision'];gate:ReleaseObservation|null;label?:string}){
 const release=releasePresentation(gate);
 return <dl className="decision-summary" aria-label={label}><div><dt>평가 판정</dt><dd><span className={'badge '+decision}>{labels[decision]}</span><small>필수 규칙과 평가 근거의 결과</small></dd></div><div><dt>현재 릴리스 판정</dt><dd><strong className={'release-state '+release}>{release==='allowed'?'허용':release==='blocked'?'허용 안 됨':'미확인'}</strong><small>{release==='unavailable'?'현재 정책 응답을 확인하기 전에는 허용하지 않습니다.':'조회 시점의 정책·검토 결과이며 실제 배포를 실행하지 않습니다.'}</small></dd></div><div className="decision-next-action"><dt>다음 행동</dt><dd>{evaluationNextAction(decision,gate)}</dd></div></dl>;
}
