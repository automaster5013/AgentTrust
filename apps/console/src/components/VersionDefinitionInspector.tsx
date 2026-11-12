'use client';
import {useState} from 'react';
import type {InspectedVersion} from '../lib/version-inspection';
/** Text only: never interpret a stored definition as HTML, a script, or executable configuration. */
export default function VersionDefinitionInspector({detail}:{detail:InspectedVersion}){
 const [expanded,setExpanded]=useState(false);
 return <section aria-label="검증된 불변 버전 정의"><p>현재 버전의 고정 정의입니다. JSON 보기로 설정을 적용하거나 현재 배포 권한을 부여하지 않습니다.</p><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'고정 정의 접기':'고정 정의 펼치기'}</button>{expanded&&<pre aria-label="고정 버전 정의 JSON" tabIndex={0} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',wordBreak:'break-word',maxWidth:'100%',maxHeight:'32rem',overflow:'auto'}}>{detail.definitionJson}</pre>}</section>;
}
