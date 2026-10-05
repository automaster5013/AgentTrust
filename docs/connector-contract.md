# 고객 에이전트 연결 계약 점검

기업 개발팀이 AgentTrust의 HTTPS 어댑터에 맞는 요청·응답 형식을 외부 연결 전에 확인하는 도구다. 기본 예제는 합성 자료이며 고객 에이전트 호출, 인증, DNS/TLS 또는 릴리스 게이트 검증을 수행하지 않는다.

```powershell
npm.cmd run connector:contract
node scripts/check-connector-contract.mjs --request .local/customer-request.json --response .local/customer-response.json
```

기본 합성 파일은 [요청 예제](../examples/connector-contract/request.json)와 [응답 예제](../examples/connector-contract/response.json)다. 사용자 파일은 UTF-8 JSON의 일반 파일이어야 하며 각각 최대 64 KiB다. 키·쿠키·인증 헤더를 이 파일 형식에 추가하지 않는다. 고객 입력이나 출력은 로컬 비공개 위치에 보관한다.

## 요청

`caseId`, `input`, `agentVersionId`의 세 문자열만 지원한다. 사례 ID와 에이전트 버전 ID는 1~80자, 입력은 1~10,000자다. 실제 HTTPS 어댑터도 같은 계약 검사로 요청을 구성하며 데이터셋의 모의 응답·규칙·정책은 전송하지 않는다. 잘못된 요청은 DNS 조회 전에 거절한다.

## 응답

`output` 문자열과 `toolEvents` 배열을 요구한다. 출력은 최대 10,000자이고 이벤트는 최대 20개다. 각 이벤트는 `name`과 객체 `args`만 갖는다. 기존 HTTPS 증거 검증과 동일하게 중첩 깊이·JSON 노드 예산·유한 숫자·유효한 Unicode를 검사한다. 추가 응답 필드나 누락된 증거는 거절한다.

## 결과와 종료 코드

계약이 유효하면 종료 코드 0과 `status: passed`를 반환한다. 실패는 종료 코드 1과 `failedStage: inputs/request/response`로 표시한다. 도구의 JSON 결과에는 요청·응답 원문, 파일 경로, 원문 오류를 포함하지 않는다. `networkRequestsMade: 0`, `releaseGateEvaluated: false`, `deploymentAllowed: false`는 형식 점검의 범위를 나타낸다. 사용자 파일을 지정한 경우 `syntheticExample: false`이며 실제 고객 연결 성공을 뜻하지 않는다.

계약 통과 후에는 [HTTPS 연결의 운영자 설정과 네트워크 통제](release-integration.md#https-연결)를 별도로 준비하고, 실제 평가 및 현재 릴리스 게이트를 통과해야 한다. 연결 대상 인증 헤더와 고객 서버는 아직 연결하지 않았다. CLI 검사는 응답의 출처·진실성·평가 규칙 통과·배포 허용을 증명하지 않는다.

CI는 소스의 합성 파일 검증과 레지스트리 worker 이미지 안의 요청·응답 계약 검사를 각각 실행한다. 기본 worker의 외부 연결 비활성 상태를 유지하며 공개 예제를 실제 고객 자료로 해석하지 않는다.

## 기록된 응답을 평가 규칙에 재현하기

```powershell
npm.cmd run connector:replay
node scripts/replay-connector-evidence.mjs --dataset .local/customer-dataset.json --policy .local/customer-policy.json --trace .local/customer-trace.json
```

기본 [데이터셋](../examples/connector-contract/dataset.json), [정책](../examples/connector-contract/policy.json), [응답 기록](../examples/connector-contract/trace.json)은 공개 합성 예제다. 사용자 파일은 각각 64 KiB 이하의 UTF-8 JSON이어야 한다. 데이터셋·정책은 기존 등록 계약을 사용하지만 이 명령은 DB에 등록하거나 변경하지 않는다. 데이터셋의 mock은 계약 유효성 확인에만 필요하며 실제 재현에는 기록된 응답만 사용한다.

응답 기록은 `schemaVersion: 1`, `agentVersionId`, 최대 100개의 `entries`를 갖는다. 각 항목의 `request`는 기존 세 요청 필드이며 `response`는 기록된 응답이다. 사례 ID·입력·에이전트 버전이 일치해야 하며 다른 사례·중복 항목은 평가 전에 거절한다. 누락 항목·응답 누락·잘못된 증거 형식은 어댑터 실패에 해당하므로 불확정 증거로 평가한다. 응답의 실제 출처나 원격 코드 버전을 증명하지 않는다.

기존 평가 코어의 필수 규칙·도구·인자 스키마·JSON 출력·통과율 기준을 적용한다. 필수 실패는 block, 필수 증거 누락·어댑터 오류는 inconclusive이며 둘이 함께 있으면 기존 코어의 필수 실패 우선순위를 따른다. 자동 평가가 pass여도 실제 관리자 검토나 현재 릴리스 게이트를 호출하지 않고 배포 허용은 false로 표시한다.

출력은 집계와 데이터셋 순서의 사례 번호·규칙 상태 개수만 포함한다. 도구의 JSON 결과에는 입력·출력·사례/규칙 ID·정책 텍스트·경로·원문 오류를 포함하지 않는다. 종료 코드 0은 오프라인 평가 pass, 1은 block/inconclusive, 2는 입력 검증 오류다. 고객 연결·서명·릴리스 승인·배포는 별도 절차다.

## 기준·후보 기록의 회귀 비교

```powershell
npm.cmd run connector:compare
node scripts/compare-connector-evidence.mjs --dataset .local/customer-dataset.json --policy .local/customer-policy.json --baseline .local/baseline-trace.json --candidate .local/candidate-trace.json
```

데이터셋과 정책을 한 번 지정하여 양쪽에 동일한 기준을 적용한다. 기준·후보 기록의 에이전트 버전 ID는 서로 달라도 되지만 각 기록 안의 모든 요청과 일치해야 한다. 기록 순서는 달라도 사례 ID와 입력으로 결합하며 추가·중복·다른 입력은 거절한다. 각 파일의 크기와 계약 제한은 기록 평가와 같다.

양쪽 증거가 완전하고 후보 평가가 pass이며 기존 pass 규칙의 회귀가 없어야 비교 pass다. 선택 규칙의 pass→fail도 후보의 전체 통과율과 별개로 회귀를 차단한다. 실패한 기준에서 통과한 후보로 개선할 수 있지만 양쪽 중 하나라도 증거가 누락되거나 불확정이면 비교는 inconclusive다. 변경은 데이터셋 순서의 사례·규칙 번호와 이전·이후 상태만 표시한다.

종료 코드 0은 오프라인 비교 pass, 1은 block/inconclusive, 2는 잘못된 입력이다. 원격 출처 검증·서명·DB 등록·관리자 승인·현재 릴리스 게이트를 수행하지 않으며 배포 허용은 항상 false다. 기본 합성 예제는 동일한 기록 두 개를 비교한다. 실제 사용자는 별도 기준·후보 기록 파일을 지정한다.
