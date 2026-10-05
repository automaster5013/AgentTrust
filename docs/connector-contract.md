# 고객 에이전트 연결 계약 점검

기업 개발팀이 AgentTrust의 HTTPS 어댑터에 맞는 요청·응답 형식을 외부 연결 전에 확인하는 도구다. 기본 예제는 합성 자료이며 고객 에이전트 호출, 인증, DNS/TLS 또는 릴리스 게이트 검증을 수행하지 않는다.

```powershell
npm.cmd run connector:contract
npm.cmd run connector:contract -- --request .local/customer-request.json --response .local/customer-response.json
```

기본 합성 파일은 [요청 예제](../examples/connector-contract/request.json)와 [응답 예제](../examples/connector-contract/response.json)다. 사용자 파일은 UTF-8 JSON의 일반 파일이어야 하며 각각 최대 64 KiB다. 키·쿠키·인증 헤더를 이 파일 형식에 추가하지 않는다. 고객 입력이나 출력은 로컬 비공개 위치에 보관한다.

## 요청

`caseId`, `input`, `agentVersionId`의 세 문자열만 지원한다. 사례 ID와 에이전트 버전 ID는 1~80자, 입력은 1~10,000자다. 실제 HTTPS 어댑터도 같은 계약 검사로 요청을 구성하며 데이터셋의 모의 응답·규칙·정책은 전송하지 않는다. 잘못된 요청은 DNS 조회 전에 거절한다.

## 응답

`output` 문자열과 `toolEvents` 배열을 요구한다. 출력은 최대 10,000자이고 이벤트는 최대 20개다. 각 이벤트는 `name`과 객체 `args`만 갖는다. 기존 HTTPS 증거 검증과 동일하게 중첩 깊이·JSON 노드 예산·유한 숫자·유효한 Unicode를 검사한다. 추가 응답 필드나 누락된 증거는 거절한다.

## 결과와 종료 코드

계약이 유효하면 종료 코드 0과 `status: passed`를 반환한다. 실패는 종료 코드 1과 `failedStage: inputs/request/response`로 표시한다. 요청·응답 원문, 파일 경로, 원문 오류는 출력하지 않는다. `networkRequestsMade: 0`, `releaseGateEvaluated: false`, `deploymentAllowed: false`는 형식 점검의 범위를 나타낸다. 사용자 파일을 지정한 경우 `syntheticExample: false`이며 실제 고객 연결 성공을 뜻하지 않는다.

계약 통과 후에는 [HTTPS 연결의 운영자 설정과 네트워크 통제](release-integration.md#https-연결)를 별도로 준비하고, 실제 평가 및 현재 릴리스 게이트를 통과해야 한다. 연결 대상 인증 헤더와 고객 서버는 아직 연결하지 않았다. CLI 검사는 응답의 출처·진실성·평가 규칙 통과·배포 허용을 증명하지 않는다.

CI는 소스의 합성 파일 검증과 레지스트리 worker 이미지 안의 요청·응답 계약 검사를 각각 실행한다. 기본 worker의 외부 연결 비활성 상태를 유지하며 공개 예제를 실제 고객 자료로 해석하지 않는다.
