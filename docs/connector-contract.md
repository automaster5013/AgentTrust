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

## 합성 수용 기준의 실제 평가·승인 시연

```powershell
npm.cmd run demo:acceptance -- --organization-index 1
node --env-file-if-exists=.env scripts/acceptance-demo.mjs --organization-index 1 --profile .local/synthetic-acceptance-profile.json
```

기본 [합성 수용 프로필](../examples/connector-contract/acceptance-profile.json)은 `schemaVersion: 1`, `synthetic: true`, 기존 데이터셋·정책 계약을 담는다. 사용자 프로필도 실제 고객 자료 대신 합성 자료를 사용한다. 파일은 64 KiB 이하의 UTF-8 JSON이다. 전체 통과율 1과 관리자 승인을 요구하며 정상 pass, 업무 회귀·금지 도구 block, 누락·실행 오류 inconclusive를 구분하는지 먼저 검증한다. 이 준비 검사는 로그인 전에 수행한다.

선택 조직의 관리자 세션과 프로젝트, 실행 여섯 개의 용량과 최근 워커 신호를 확인한 후 데이터셋·정책을 불변 버전으로 등록한다. 같은 이름만으로 재사용하지 않고 내용 해시와 실제 저장된 버전을 대조한다. 기존 버전을 수정하지 않는다. 기준 실행 하나와 후보 다섯 개를 실제 로컬 Docker 워커의 모의 어댑터로 평가한다.

정상 후보는 승인 전 차단, 승인 후 허용, 시연 종료 시 반려 후 차단을 확인한다. 나머지 후보는 계속 차단하며 기준·후보 결과, 조직·프로젝트, 고정 버전에 결합된 영수증 서명 일곱 개를 검증한다. 실패 시 생성한 미완료 실행을 취소하고 시도한 승인을 반려하며 자체 세션을 종료한다. 이 시연의 허용 결과는 합성 실행에 한정하고 실제 고객 연결이나 서버 배포를 수행하지 않는다.

성공 종료 코드는 0이고 준비·평가·검증·정리 실패는 1이다. 비공개 보고서는 새 `.local/acceptance-demo-*.json`에 저장한다. 표준 출력은 상태·단계 수·서명 확인 수·정리 여부만 표시하며 접근 키·쿠키·기준과 응답의 원문을 포함하지 않는다. CI는 소스와 레지스트리 API·워커에서 두 번씩 실행하여 최초 등록과 정확한 기준 재사용을 확인한다.

## 수용 기준과 승인 증거 묶음의 오프라인 검증

```powershell
npm.cmd run demo:acceptance -- --organization-index 1 --export-evidence
node scripts/verify-acceptance-evidence.mjs .local/acceptance-evidence-UUID .local/receipt-signing/public.pem EXPECTED_MANIFEST_SHA256
```

내보내기는 시연 성공·미완료 실행 정리·반려·로그아웃을 모두 확인한 후 수행한다. 새 비공개 디렉터리에 프로필, 평가 결과 여섯 개, 서명 영수증 일곱 개, 승인·반려 의견 두 개와 마지막 manifest를 저장한다. **합성 입력·응답·규칙·의견 원문이 포함된다.** 실제 고객 자료를 이 시연 프로필에 넣지 않는다. 표준 출력은 생성 위치와 manifest SHA-256, 검증 상태를 표시하고 원문을 포함하지 않는다.

검증에는 독립적으로 신뢰하는 Ed25519 공개 키와 내보내기 때 받은 manifest SHA-256을 모두 요구한다. 묶음 안에 들어 있는 키를 자동 신뢰하지 않는다. 고정 파일 목록·바이트 수·SHA-256·총 64 MiB 제한·UTF-8 JSON 계약을 검사하며 추가·누락·경로 변경 파일은 거절한다. 각 평가의 snapshot·결과 해시와 규칙·통과율·버전 결합을 기존 무결성 검사로 다시 확인한다.

프로필의 데이터셋·정책 해시는 모든 평가에 일치해야 한다. 영수증의 서명과 조직·프로젝트·기준/후보 실행·고정 버전·결과 해시를 대조하며 비교 결과도 기존 비교 코어로 재계산한다. 승인·반려 의견은 해당 영수증의 reviewHash와 결합한다. 승인 전 차단 → 과거 승인 시 허용 → 반려 후 차단과 나머지 네 실패 후보의 차단을 확인한다.

manifest 자체의 서버 서명을 주장하지 않는다. 독립 전달받은 manifest 해시는 파일 묶음의 일관성을 확인하고 서버 서명은 영수증의 과거 결정을 인증한다. 검증은 API·DB·원격 에이전트를 호출하지 않으며 현재 멤버 권한·현재 승인 유효성·현재 릴리스 허용을 확인하지 않는다. 성공 종료 코드는 0, 오류는 원문 없는 blocked 결과와 종료 코드 2다. 실제 현재 배포 판단은 별도의 릴리스 게이트를 사용한다.

## 수용 기준 등록 전 버전 용량 확인

v0.157부터 관리자 운영 상태는 조직 전체 에이전트·데이터셋·정책 버전의 사용 수와 1,000개 한도의 남은 수를 제공한다. 운영 패널에도 표시하며 다른 조직·잘못된 수치는 용량 미확인으로 안내한다. 조회 시작과 실패, 로그아웃·프로젝트 변경 시 이전 값을 정리한다.

수용 시연은 카탈로그의 정확한 이름·내용 해시를 사용해 새로 필요한 기준 버전 0~2개를 계산한다. 관측 시점에 용량이 부족하거나 조직 범위·수치가 잘못되면 실제 버전 읽기·등록과 평가 생성 전에 중단한다. 두 기준을 모두 재사용할 수 있으면 한도가 가득 차도 계속할 수 있으며 저장된 버전 내용의 무결성 검사는 유지한다. 이 기능은 슬롯 예약이나 여러 등록의 원자적 묶음이 아니다. 서버는 각 실제 등록 시 조직 잠금 아래 한도를 다시 검사한다. 역할 권한과 버전 불변성은 유지한다.

## Docker·인증 없는 수용 프로필 준비 점검

```powershell
npm.cmd run acceptance:check
node scripts/check-acceptance-profile.mjs --profile .local/synthetic-acceptance-profile.json
```

v0.158부터 수용 프로필을 실제 시연과 동일한 순수 검증으로 먼저 확인할 수 있다. Node.js와 설치된 프로젝트 의존성을 사용하며 Docker·API·DB·접근 키·`.env`를 읽지 않는다. 각각의 합성 모의 동작이 정상 pass, 업무 회귀·금지 도구 block, 누락·오류 inconclusive를 구분해야 하고 전체 통과율 1과 관리자 승인을 요구한다. 사용자 프로필은 기존 64 KiB·UTF-8 JSON 제한을 따른다.

성공 결과는 사례·규칙 수와 다섯 기대 결과만 표시한다. 프로필 원문·이름·입출력·경로·원문 오류를 JSON 결과에 포함하지 않는다. 종료 코드 0은 준비 점검 성공, 1은 잘못된 옵션·프로필이다. 실제 버전 등록·실행·서명·현재 승인·배포 허용을 수행하지 않는다. CI는 소스의 기본 프로필과 레지스트리 worker 이미지 안의 같은 검증 코어를 확인한다.
