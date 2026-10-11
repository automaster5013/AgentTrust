import type {CaseDefinition} from '../lib/campaign-contracts';
export default function ReferenceCaseFields({value,index,onChange}:{value:CaseDefinition;index:number;onChange:(change:Partial<CaseDefinition>)=>void}){
 return <><label>평가 입력 {index+1}<textarea required maxLength={192} aria-label={'평가 입력 '+(index+1)} value={value.input??''} onChange={event=>onChange({input:event.target.value})}/></label><p>입력 {new TextEncoder().encode(value.input??'').length}/192바이트</p><label>기대 정답 {index+1}<input required maxLength={128} aria-label={'기대 정답 '+(index+1)} value={value.expected??''} onChange={event=>onChange({expected:event.target.value})}/></label><p>정답 {new TextEncoder().encode(value.expected??'').length}/128바이트</p><p>JSON의 answer 문자열을 Unicode 정규화 후 정확히 비교합니다. 의미 유사도 평가는 수행하지 않습니다.</p></>;
}
