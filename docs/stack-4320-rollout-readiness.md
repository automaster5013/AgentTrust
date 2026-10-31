# 4320 통합 화면·관리 기능 적용 준비

2026-11-01 KST. 검토 대상 소스는 `e23b02de5f2609d960a622b0e17e5d3dc9ea76a2`다. 이 문서는 실행 명령/승인서가 아니다. 운영 배포·게시·DB 변경·컨테이너 교체는 수행하지 않았다.

## 확인된 현재 상태

- 최종 플랫폼은 4320이며 4310은 보존한다. 현재 AgentTrust 20개와 LogiTrack 12개는 healthy다. ID/image/StartedAt은 비공개 읽기 전용 기준선에 고정했다.
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
