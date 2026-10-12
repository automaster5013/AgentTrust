import {versionLifecycle} from './version-lifecycle.ts';
import type {Identity} from './contracts.ts';
import type {Version} from './campaign-contracts.ts';
export function requireActiveVersion(value:unknown,user:Identity,kind:'agents'|'datasets',version:Version){
 const state=versionLifecycle(value,user,kind,version.id,version.content_sha256);
 if(state.state!=='active')throw Error('폐기된 버전은 새 평가 실행에 사용할 수 없습니다. 새 버전을 등록해 주세요.');
 return state;
}
