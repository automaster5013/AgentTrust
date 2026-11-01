# 4320 통합 화면·관리 기능 적용 준비

2026-11-01 KST. 통합 관리 기능의 초기 기준 소스는 `e23b02de5f2609d960a622b0e17e5d3dc9ea76a2`다. 이후 복귀 하네스의 실제 결과는 아래 revision별 기록을 따른다. 이 문서는 실행 명령/승인서가 아니다. 운영 배포·게시·DB 변경·컨테이너 교체는 수행하지 않았다.

## 확인된 현재 상태

- 최종 플랫폼은 4320이며 4310은 보존한다. 보호 대상 AgentTrust 20개와 LogiTrack 12개의 상태·ID/image/StartedAt은 관측 시점에 묶인 비공개 읽기 전용 기준선으로 관리한다. CI 결과나 과거 관측은 현재 PC의 건강 상태·신원 일치 검사를 대신하지 않는다.
- 현재 Console/Gateway의 이미지 source revision은 `d40cdd063f7f711fdd513d231ec2da2473796619`, Core는 `1c9374edc0cd6cbb03f164099ce6d74e0f5fd782`다. 이 값은 inspect label이며, 새 후보 서명 검증을 대신하지 않는다. 실행 중 이미지가 모두 같은 source commit이라고 가정하지 않는다.
- 운영 Flyway 이력은 V17/18개 public 테이블이다. 후보의 V1~V17 script/checksum이 운영 이력과 모두 일치했다. V18 관리 테이블 3개는 없다. 관측은 실행 직전 다시 확보해야 하며 영구적인 적용 허가가 아니다.
- V18 파일 SHA-256: `8ad970c7e5f5e6a784ee201322567658f167a316f7d3acbf35661b1a7f78e061`, Flyway checksum: `1490751471`.
- 후보의 실제 관리 브라우저 2개 시나리오와 TLS OIDC 로그인은 CI run `41215212206`에서 통과했다. 전체 integration은 별도 최종 결과가 필요하다. PR 이미지 게시·서명 발급·운영 적용을 뜻하지 않는다.

## 적용 순서와 각 종료 조건

| 순서 | 준비 작업 | 통과 증거 / 중단 조건 |
|---|---|---|
| 1 | 같은 소스의 전체 CI를 최종 확인 | integration 최종 success, 실제 모델·암호화 복구·정리 포함. 진행 중/실패면 적용 중단 |
| 2 | 검증된 후보 이미지·서명·출처 고정 | Core/Gateway/Console을 포함한 기존 16개 delivery manifest 계약 유지. registry digest/config/runtime identity와 서명·source/빌드 출처를 검증. PR의 로컬 CI 이미지나 이동 가능한 tag를 배포 후보로 쓰지 않음 |
| 3 | V17→V18 및 이전 이미지 호환성을 격리 검증 | 운영 자료 없이 합성 V17 DB→동일 checksum V18 migration-only→API 제한 역할→3개 테이블 강제 RLS/append-only→구/신 Core 호환성. 신규 V18 DB에서 시작한 통합 성공만으로 전환 성공을 주장하지 않음 |
| 4 | 실제 운영 복구 준비 조건 확보 | 승인된 환경의 자원 기준, 최신 source/path 재검사, 인증된 독립 사본·fresh reader·재인증·저장소 일관성 및 실패 정리. 운영 자료를 공개 CI로 전송하지 않음. 현재 자원/복구 미충족을 합성 증거로 대체하지 않음 |
| 5 | 적용·복귀 계획을 정확한 후보와 운영 기준선에 결합 | compose/env hash, DB ledger, image digest, 영향 서비스, 키/세션/대기 작업, 관측 시점과 승인 만료를 바인딩. baseline에 없는 서비스 변경 금지 |
| 6 | 승인된 유지보수 단계에서만 migration·교체·수용 | 동일 후보의 별도 migration-only 프로세스와 Core/Gateway/Console 교체 순서를 격리 시험으로 확정. 4320 실제 로그인·설정 CAS·키 조회/철회·본인 다른 세션 종료·기존 평가/캠페인 회귀 및 32개 서비스 건강 확인 |

## 기존 실행부의 보호 경계

`stack-local-cd-evidence.py:same_schema`는 현재 V17과 후보 V18의 차이를 거부한다. 읽기 전용 확인에서도 이 거부가 재현됐다. `stack-local-cd-deploy.py`의 prepare/execute 경로를 우회하거나 ledger를 수동 수정하지 않는다. 현재 executor는 이 schema 전환을 실행할 권한/기능이 없는 것으로 처리한다. 별도 검증된 schema 전환 계약 없이는 `--execute`를 호출하지 않는다.

현재 API는 제한 역할을 사용하고 Flyway 자동 실행을 끈다. DDL 자격 증명은 별도 `--migrate-only` 프로세스에만 제공한다. 후보 이미지를 실행하는 것만으로 V18이 준비됐다고 가정하거나 API에 migration 자격 증명을 넣지 않는다. V18에는 새 테이블·RLS·grant가 있으므로 추가형 migration이어도 운영 DB 쓰기이며 이번 보존 요청의 실행 범위 밖이다.

## 복귀·키·세션의 주의점

- 기존 이미지 digest와 설정을 보존한다. 이미지 복귀와 DB 원상 복구는 다르다. V18에 관리 설정/키/철회 감사가 생긴 뒤 테이블 삭제나 ledger 삭제를 복귀 방법으로 쓰지 않는다. 구 Core가 V18 schema에서 기존 평가·권한을 정상 처리하는지는 합성 격리 시험으로 별도 확인해야 한다.
- 신규 키는 메타데이터 조회 전용이며 기존 CI/릴리스 키가 아니다. 구 이미지로 돌아가면 이 endpoint가 사라질 수 있다. 미확인 발급의 목록 재확인·철회, 기능 중지 상태 표시, 원문 재표시 금지와 기록 보존을 복귀 계약에 포함한다. 건강한 rollback 보장은 아직 false다.
- Core의 앱 세션/관측 목록은 메모리 기반이다. Core 교체 시 앱 재로그인이 필요할 수 있고 Keycloak SSO 전체 종료와 같지 않다. 새 UI의 세션 종료는 현재 Core에서 관측한 동일 actor의 다른 앱 세션만 대상으로 한다. 기존 세션 handle을 새 Core에 승계하지 않는다.
- 새 코드가 실행되려면 최소 Core/Gateway/Console의 프로세스/컨테이너 교체가 필요하다. 기존 모든 ID/image/StartedAt을 그대로 유지하면서 운영 4320을 최신 코드로 바꾸는 것은 불가능하다. 현재는 유지 조건을 지키며 준비만 진행한다. 향후 실행에는 영향 서비스 교체와 재인증을 명시한 별도 승인 및 검증된 복구 조건이 필요하다.

## 현재 판정

`actualDeploymentPerformed=false`, `automaticDeploymentAllowed=false`, `operatingRecoveryVerified=false`, `healthyRollbackGuaranteed=false`. 게시 enablement·merge·운영 migration·컨테이너 재생성은 수행하지 않았다. LogiTrack·4310·현재 대화는 보존한다. 이 계획의 증거를 실행 시점의 최신 검사나 승인으로 재사용하지 않는다.

## 추가한 격리 검증의 실행 범위

`stack-database-process-adversarial.py --v17-transition`을 기존 GitHub-hosted integration fixture에 연결했다. 로컬 실행은 GitHub-hosted 환경 guard로 거부한다. 고정 digest/source revision을 확인한 V17 Core를 사용하며 전용 tmpfs DB·internal network·새 합성 자격 증명만 사용한다. 기존 DB/volume 복사·마운트·호스트 port 공개는 없다.

순서는 V17 migration-only → 합성 감사 행 생성 → 이전 제한 역할 확인 → 후보 V18 1건 적용 → 기존 17개 업무 테이블의 전체 행수/hash 일치 → 관리 설정·철회된 키 합성 행 생성 → 이전 Core의 제한 역할 프로세스로 복귀 → 전체 20개 업무 테이블 보존 → 후보 migration 재실행 0건 → 후보 역할 재확인이다. 이전 migrator를 V18 위에서 실행하지 않는다. 기존 fixture의 소유권 확인·정리와 비정상 권한 검사를 유지한다.

이전 이미지는 고정 공개 registry digest와 source label을 대조하지만 이 시험에서 서명을 재검증한 것은 아니다. `baselineSignatureVerified=false`이며 새 서명된 배포 후보로 사용하지 않는다. 이전 Core의 전체 HTTP 기능이나 브라우저 복귀를 실행하는 시험은 아니므로 `oldFullApiBusinessFlowVerified=false`, `healthyRollbackGuaranteed=false`를 유지한다.

Full-path 모의/실패 테스트 7개, Python 문법·actionlint는 로컬 통과했다. 기존 행 변경·철회 기록 소실·잘못된 baseline·migration 재적용·이전 역할 실패를 거부한다. 실제 격리 전환 결과는 새 CI에서 별도로 확인하며, 실행 전에는 성공으로 표시하지 않는다.


## 이전 Core HTTP·브라우저 복귀 검증 경로

`stack-core-return-smoke.py --execute`는 현재 PC와 self-hosted runner에서 실행을 거부한다. 비 root GitHub-hosted runner, 정확한 repository/workspace와 compose 경로를 확인한 일회성 합성 스택에만 연결한다. 기존 회귀 데이터와 V18 스키마를 가진 CI Core만 고정 이전 이미지로 교체한다. 운영 자료·기존 PC 서비스·현재 대화에는 연결하지 않는다.

이전 Core에서 직접 API와 4320 BFF의 HTTP 회귀를 실행하고, 관리 시나리오를 제외한 기존 브라우저 회귀와 관리 API 미지원의 명시적 표시(고정 이전 이미지의 실제 누락 경로 응답은 정제된 500)를 추가로 확인한다. 후보에만 있는 관리 기능을 이전 Core의 지원 기능으로 간주하지 않는다. 이전 Core에서 새 키/설정이 정상 생성됐다고 표시해서도 안 된다.

시도 중 예외·부분 교체·API/브라우저 실패가 발생해도 `finally`에서 동일 후보 Core의 복원을 시도한다. 그 뒤 후보의 새 관리 기능을 포함한 HTTP 검사를 재실행한다. 이전 migrator·DB down migration·ledger 변경은 실행하지 않는다. 기존 모든 행의 해시 다중집합이 유지되고 새 시험 행만 추가될 수 있는지, 이전 Core 실행 동안 관리 테이블은 정확히 같은지, 스키마 ledger와 Core 외 CI 컨테이너 ID/image/StartedAt이 보존되는지 확인한다. 행 본문·쿠키·키·환경 비밀값은 보고하지 않는다.

시험은 30분의 주 작업 한도와 별도의 최대 5분 후보 복원 한도를 사용한다. 실제 광범위 HTTP/브라우저 회귀가 통과해도 `allPossibleApiRoutesVerified=false`, `operatingRecoveryVerified=false`, `healthyRollbackGuaranteed=false`, `automaticDeploymentAllowed=false`를 유지한다. 모든 가능한 API 경로, 운영 데이터 복구와 운영 무중단 전환을 증명하는 것은 아니다. 실제 결과는 추가 CI 단계가 성공한 뒤 별도로 기록한다.

로컬 확인: 복귀/복원 순서·예외 경로·행 보존·hosted guard 테스트 7개와 V17 전환 테스트 7개 통과, TypeScript·Python 문법·actionlint 통과. 기존 관리 HTTP 검사는 AST 비교로 기본 경로가 그대로 유지됨을 확인했다. 이전 Core 모드의 브라우저 시나리오 55개가 검색되었으며, 검색/모의 검증은 실제 실행 통과와 다르다. 현재 PC 실행은 Docker 작업 전에 거부됐다. 이전 `e23b02d`는 전체 integration 포함 6개 CI 최종 성공, `6091814`의 전체 최종 결과는 이 기록 시점 미확정이다.


## 2026-11-01 실제 CI 확인과 첫 복귀 하네스 수정

`609181416ae4a1863425e5789dfdbf6aea2f1993`의 integration run `41220871612`는 최종 success다. 실제 V17→V18 전환, 관리 브라우저, TLS OIDC, 전체 브라우저 회귀, 고정 모델, DB/MinIO/전체 일관 암호화 복구 및 정리가 모두 통과했다. 다른 5개 PR workflow도 최종 success이며 이미지·publication job은 skipped다.

`61eb96e8c947c6f13bf6673ca2d3439a66b840c5`의 integration run `41224504494`는 최종 failure다. 후보의 전체 브라우저 회귀까지 통과했으나 새 이전 Core 복귀 단계는 사전 대기 SQL에서 종료 코드 3으로 실패했다. `stack_campaigns`에는 `state` 열이 없는데 이를 조회한 하네스 오류다. 이전 Core 교체 전의 실패이므로 실제 이전 Core HTTP·브라우저 복귀 또는 후보 복원 성공의 증거가 아니다. 이후 모델·전체 복구 단계는 skipped, 격리 서비스 정리는 success다.

대기 SQL을 모든 독립 실행 및 캠페인 하위 실행이 저장되는 `stack_runs`의 queued 행수로 수정했다. 캠페인 자체에 상태 열을 추가하거나 운영 스키마를 변경하지 않는다. 상태 열 없는 캠페인과 queued/완료/실패 하위 실행을 가진 메모리 DB에서 실제 SELECT를 실행하는 회귀 테스트를 추가했다. 복귀 흐름 8개와 V17 전환 7개, 총 15개 로컬 테스트 및 Python 문법 검사가 통과했다. 수정된 실제 hosted 복귀 결과는 별도 CI에서 확인해야 한다.

현재 PC의 보호 대상 32개는 읽기 전용 inspect에서 모두 healthy이며 비공개 기준선의 ID/image/StartedAt과 일치했다. 운영 배포·migration·publication·자동 CD·운영 복구 검증은 수행하지 않았다. 기존 보류 gate는 그대로 유지한다.


### 실패 후 후보 복원 검증의 예외 경로 보완

추가 검토에서 이전 Core 단계가 실패하면 `finally`의 후보 교체 뒤 HTTP·기존 행 보존 검사가 건너뛰어지는 공백을 로컬 회귀 테스트로 재현했다. 후보 복원·관리 기능 포함 직접 API/BFF HTTP·기존 행 및 ledger 보존 검사를 모두 `finally` 경로로 묶었다. 이전 단계가 실패하면 복원이 확인돼도 전체 시험은 계속 실패하며, 안전 보고서는 이전 실패 단계/타입과 `candidateRestored`, `candidateHttpVerified`, `candidateRowsPreserved`를 구분한다.

주 작업 예산이 소진된 뒤에도 별도 5분 복원 예산이 후보 교체뿐 아니라 HTTP·행 보존·Core 외 컨테이너 ID/image/StartedAt·healthy 검증까지 적용되도록 수정했다. 복원 뒤 비 Core 상태 검사는 이전 단계 실패 시에도 수행하고, 실패하면 전체 성공을 거부한다. 로컬 복귀 흐름 테스트 10개와 V17 전환 7개가 통과했다. 이는 모의 예외 경로 검증이며, 수정 후보의 실제 hosted 결과는 별도 확인한다. 운영 복구·자동 CD·건강한 운영 rollback 허용을 뜻하지 않는다.


### 실제 Playwright 목록으로 확인한 이전 Core 테스트 선택자 수정

Playwright의 전체 제목에는 파일명이 앞에 붙으므로 `--grep-invert '^workspace management'`는 관리 테스트 두 개를 제외하지 못했다. `STACK_E2E_LEGACY_CORE_RETURN=true`의 실제 `--list`에서 두 관리 테스트가 포함된 55개 목록을 확인했다. 선택자를 `(^|\s)workspace management\s`로 수정한 뒤 53개/2파일을 확인했고, 두 관리 쓰기 테스트는 제외되고 당시 404를 기대하던 이전 Core 관리 API 부재 표시 테스트는 포함됨을 확인했다. 기본 후보 모드의 관리 테스트 등록·실행은 변경하지 않았다. 목록 검사는 브라우저 실행 성공의 증거가 아니며 전체 hosted 결과는 별도 확인한다.


### 불변 입장 기록과 완료 결과를 결합하는 대기 조건 수정

`e9da6ea`의 실제 integration run `41229013188`는 후보의 전체 브라우저 회귀까지 통과했으나, 복귀 사전 대기에서 90초 후 `ValueError`로 최종 실패했다. SHA-256 검증한 진단 artifact는 `stage=preflight`, `candidateRestored=false`이며 이전 Core 교체 전 실패다. 단순 `stack_runs.state='queued'` 조회는 불변 입장 기록을 완료 뒤에도 계속 세는 오류였다. 실제 서버의 pending 조회와 동일하게 `stack_run_results`를 LEFT JOIN하고 결과가 없는 queued 실행만 세도록 수정했다. 캠페인 하위 실행도 같은 행을 사용하므로 별도 캠페인 상태 열은 필요하지 않다.

회귀 fixture는 입장 4개를 모두 queued로 보존하면서 별도 결과 행에 완료/실패를 추가한다. 기존 완료·실패는 제외하고 독립 실행과 캠페인 하위 실행의 미완료 두 개만 세며, 결과 추가 후 2→1→0을 확인했다. 대기 시간·행 보존 기준을 낮추거나 DB를 수정해 비우지 않는다. 대기 실패에는 안전한 미완료 건수와 고정 진단 코드를 남긴다. 로컬 복귀 10개·V17 전환 7개 및 Python 문법 검사가 통과했다. 실제 수정 후보의 복귀·후속 전체 integration은 별도 확인한다.


### 실제 이전 Core 전환과 실패 뒤 후보 복원 확인

`a2321ec40e1f15a1914462abbd3f0bd3ca1ce15d`의 실제 integration run `41233629185`는 수정된 대기 조건을 통과해 고정 이전 Core를 실행했다. 이전 직접 HTTP의 관리 API 부재 검사에서 기대 404 대신 500/`REQUEST_UNAVAILABLE`이 반환돼 복귀 단계는 실패했다. SHA-256 검증한 안전 요약은 `quietCheckPendingRuns=0`, `candidateRestored=true`, `candidateHttpVerified=true`, `candidateRowsPreserved=true`, `nonCoreContainerIdentitiesPreserved=true`다. 실패 뒤 동일 후보 복원과 직접 API/BFF의 관리 기능 포함 HTTP, 기존 행/ledger 및 비 Core 컨테이너 보존은 실제 확인됐다. 이전 전체 업무 HTTP·브라우저 검증 성공은 아직 아니다. 후속 모델·전체 복구는 skipped이며 전체 integration은 실패다.

고정 이전 소스 `1c9374e`에는 관리 controller가 없다. `ApiErrors`의 공통 예외 처리는 누락 경로를 정제된 500으로 반환한다. 같은 의존성 Spring MVC 7.0.9의 ResourceHttpRequestHandler도 GET/POST의 리소스 부재를 method 검사 전에 처리한다. `c13650a`는 하네스의 404 가정을 고정 이미지의 정확한 500 + `{"code":"REQUEST_UNAVAILABLE"}` 계약으로 수정했다. 네 개의 미지원 관리 요청에만 적용하며, 임의 500/503/다른 code/추가 권한 필드나 정상 응답은 거부한다. 이를 관리 기능 성공으로 표시하지 않고 `managementApiSupported=false`, `previousManagementApiCompatibilityVerified=false`와 실제 상태 코드 목록을 기록한다. UI도 관리 정보를 확인할 수 없다는 메시지와 설정/키 원문 부재를 검사한다.

기존 업무 HTTP와 후보 관리 HTTP의 기대값·권한·서명/hash 검사는 유지했다. AST로 기본 후보 관리 분기의 검증 의미가 같음을 확인했고, legacy 블록 밖 브라우저 소스도 동일했다. 고정 오류 응답 거부 테스트를 포함한 복귀 11개·V17 전환 7개 및 Python/TypeScript 검사가 통과했다. 수정 후 legacy 목록은 여전히 53개/2파일이다. 이 수정의 실제 hosted 이전 업무 HTTP·브라우저·후보 복원 및 후속 전체 integration은 새 실행에서 확인해야 한다. 자동 CD·운영 복구·건강한 운영 rollback 판정은 계속 false다.


### 이전 업무 HTTP 통과·브라우저 52/53과 취소된 오류 본문 검사 수정

`c13650a` run `41239127671`와 `3372f96` run `41239170356`은 전체 integration 최종 failure다. SHA-256 검증한 artifact에서 이전 Core의 직접 4321·BFF 4320 업무 HTTP가 모두 completed/본인 세션 정리 성공이고, 고정 관리 미지원 응답 네 건은 각각 500임을 확인했다. 후보 복원 뒤 두 경로의 관리 기능 포함 HTTP와 기존 행/ledger 보존도 통과했다. 이전 브라우저는 두 실행 모두 53개 중 기존 52개 통과, 추가한 관리 부재 검사 1개 실패다.

실패는 UI가 오류 응답 본문을 의도적으로 취소한 뒤 Playwright `response.json()`이 본문을 다시 읽으려 한 시험 오류다. 실제 UI 요청의 500 상태·오류 메시지·설정/키 원문 부재 검사를 유지하고, 정확한 JSON 오류 본문은 같은 세션 APIRequestContext의 별도 읽기 요청으로 검증하도록 수정했다. production UI의 본문 취소나 HTTP 오류 계약은 변경하지 않았다. 로컬 TypeScript와 Python 검사가 통과했으며 실제 수정 후 브라우저 실행은 새 CI에서 확인한다.

두 실행 모두 비 Core 보존 검증도 AssertionError로 실패했다. 기존 요약만으로 ID/image/StartedAt 변화인지 건강 상태 문제인지 구분할 수 없으므로 원인은 미확정이다. 이를 통과로 바꾸거나 대기/재시작으로 숨기지 않는다. 후속 요약에 컨테이너 집합·이미지/시작 시각·실행·healthy 조건의 안전한 차원별 진단을 추가했다. ID·이미지 값·시각·환경 비밀은 보고하지 않는다. 기존 조건을 모두 만족해야 통과하며 누락/중복/추가 컨테이너도 거부한다. 복귀 13개·V17 전환 7개, 총 20개 로컬 테스트가 통과했다.

이전 전체 브라우저 성공, 비 Core 보존 성공 및 후속 모델·전체 복구 완료는 아직 미확인이다. 실제 운영 배포·자동 CD·운영 복구·건강한 운영 rollback은 계속 false다.


### 2bae3c1 실제 브라우저 53개 통과와 worker 보존 실패의 원인

`2bae3c17773a317e3ba60047d9b4f0e5cc036260` run `41245089222`는 최종 failure다. SHA-256 검증한 안전 보고서는 이전 Core 직접 API/BFF HTTP·브라우저 53개·후보 복원 및 HTTP·기존 행/철회 기록·ledger 보존을 모두 통과했다고 기록한다. 비 Core의 컨테이너 집합과 이미지는 동일하고 모두 running/healthy였으나 `stack-ai-worker`의 StartedAt이 달라 전체 검증이 실패했다. 후속 모델·전체 복구는 skipped다.

원인은 기존 `administrator cancels a real pending evaluation and campaign through browser controls` 시험이 의도적으로 worker를 stop/start하는 것이었다. 이는 worker 프로세스를 보존하는 Core 복귀 시험의 조건과 충돌한다. 이 취소 시나리오를 제외하거나 StartedAt 검사를 낮추지 않는다. 기본 후보 브라우저의 기존 stop/start를 유지하고, legacy 복귀 모드에서만 동일한 실제 대기·취소·게이트 검사를 소유한 합성 worker의 pause/unpause로 수행하도록 수정했다. 전체 legacy 검색 목록은 53개로 유지한다. 이 모드는 worker 재시작 검증을 뜻하지 않으며 기존 후보 브라우저·후속 서비스 재시작 단계의 범위와 구분한다.

새 helper는 비 root GitHub-hosted guard를 Docker·witness 파일 접근 전에 검사한다. 정확한 repository/workspace/run/attempt, worker 이름·compose 소유권·설정 파일 목록과 ID/image/StartedAt을 검증한다. pause 전 0600 비공개 witness를 만들고 동일한 worker만 unpause한다. witness는 안전 artifact 수집 glob에 포함되지 않는다. 브라우저의 finally가 실행되지 않아도 Core 복원 finally에서 해당 invocation의 worker cleanup을 별도로 수행하며, cleanup 실패가 Core 복원 시도 자체를 막지 않는다. 기존 5분 복원 예산을 공유한다. 최종 비 Core 검사는 같은 집합·이미지/StartedAt·running·unpaused·healthy 및 worker cleanup 증거가 모두 참이어야 통과한다.

실제 현재 PC에서 pause/unpause를 실행하지 않았다. 로컬 --execute는 Docker/파일 접근 전에 거부됐다. 모의 helper 8개(부분 pause 복구, 교차 run·소유권·시작 시각 변화·중복 witness 거부 포함), 복귀 13개와 V17 전환 7개, 총 28개 로컬 테스트·Python/TypeScript·actionlint가 통과했다. 수정된 실제 hosted 비 Core 보존과 전체 integration 성공은 새 CI에서 별도로 확인한다. 운영 적용·자동 CD·운영 복구·건강한 운영 rollback은 계속 false다.


완료된 worker witness의 재사용 경계도 모의 실패로 확인했다. 이미 unpause 완료된 witness는 현재 동일 identity가 unpaused 상태인지 읽기 전용으로 확인할 수 있지만, 나중에 다른 원인으로 paused가 되면 이를 해제하지 않고 거부한다. 해당 거부 테스트를 추가한 helper 9개와 기존 복귀 13개·V17 전환 7개, 총 29개 로컬 테스트가 통과했다. 이 보강은 기존 healthy·ID/image/StartedAt·unpaused 조건을 완화하지 않는다.


### worker 보존 수정의 실제 결과와 프로젝트 홈 시험 관찰 경합

`5bc266d` run `41251330456`의 이전 Core 복귀 단계는 실제 success다. 최신 `543bc26` run `41251528125`는 별도의 프로젝트 홈 브라우저 관찰 실패로 최종 failure였지만, SHA-256 검증한 보고서에서 worker cleanup과 비 Core 컨테이너 집합·이미지/StartedAt·running·unpaused·healthy가 모두 true이고 issues가 비어 있음을 확인했다. 후보 복원·HTTP·기존 행 보존도 true다. 따라서 worker stop/start 때문에 발생하던 보존 실패는 실제 검증에서 해소됐다. 운영 컨테이너나 현재 PC를 pause/unpause한 것은 아니다.

`543bc26`의 실패 1개는 홈 재조회 HTTP 200 응답을 Playwright Response에서 늦게 읽는 중 `responseBodyUnavailable`이 된 시험 관찰 경합이다. 이전 실행들에서는 통과했으나 이번 실패를 재시도로 숨기지 않는다. 같은 실제 재조회 GET을 pass-through route로 관찰하고 원래 응답을 그대로 UI에 전달한 뒤, 그 응답의 판정별 건수와 실제 화면의 표시를 비교하도록 수정했다. 별도 GET으로 얻은 다른 값을 사용하지 않고 byte 변경·자동 retry·redirect를 허용하지 않는다. UI의 오류/미확인 처리·1MiB 제한·UTF-8/응답 계약은 바꾸지 않았다. 이 수정의 후보/legacy 브라우저 및 전체 integration은 새 CI에서 확인한다.


### 정리 완료 후 늦은 worker pause 요청 거부

브라우저 자식이 늦게 시작하는 예외 경로를 모의 실행해, 아직 pause witness가 없을 때 먼저 수행된 cleanup이 같은 invocation의 뒤늦은 pause를 허용함을 재현했다. cleanup은 Docker를 호출하지 않고 해당 run/attempt의 witness를 원자적으로 닫는다. 이후 같은 witness의 pause는 Docker 접근 전에 거부되고 반복 cleanup도 파일을 덮어쓰거나 컨테이너를 변경하지 않는다. 실제 pause를 수행한 witness의 소유권·ID/image/StartedAt 검증과 복구 동작은 유지한다. 이는 정리 이후 아직 witness를 얻지 못한 요청의 권한을 닫는 범위이며 모든 자식 프로세스 종료를 증명하지 않는다.

helper 10개·복귀 13개·V17 전환 7개, 총 30개 모의/로컬 테스트가 통과했다. 운영 pause/unpause·재시작·배포는 수행하지 않았다. 이 변경의 실제 hosted 결과는 새 CI에서 확인한다. 별도로 `5bc266d` run `41251330456`은 전체 integration도 최종 success이며 SHA-256 검증한 보고서에서 이전 브라우저 53개·후보 복원/HTTP·기존 행/ledger·비 Core 집합/이미지/StartedAt/running/unpaused/healthy 및 후속 합성 복구 단계의 성공을 확인했다. 운영 복구·자동 배포·건강한 운영 rollback을 뜻하지 않는다.
