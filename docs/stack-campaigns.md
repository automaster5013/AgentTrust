# 원래 스택의 불변 버전과 평가 캠페인

이 기능은 새 Java/PostgreSQL API에 에이전트 설정과 고정 시나리오 데이터셋을 등록하고, Python 워커의 여러 실행을 하나의 캠페인으로 집계한다. 기존 JavaScript v0.187의 버전·데이터는 복사하거나 수정하지 않는다.

## 실제 실행 경로

Next.js/TypeScript → WebFlux의 인증·CSRF·Redis 한도 → Java 21/Spring Boot → PostgreSQL의 조직·프로젝트 RLS → NATS JetStream → Python/FastAPI → 버전 결합을 확인하는 Java 완료 API → 캠페인 집계 → OPA/Rego → 관리자 승인 또는 최신 반려.

`http://127.0.0.1:4320`에서 로그인한 뒤 **버전과 평가 캠페인** 영역을 사용한다. 관리자와 편집자는 버전을 등록하고 실행할 수 있다. 조회자는 읽을 수 있고, 캠페인 승인·반려는 관리자만 저장할 수 있다.

## 버전 계약

`POST /api/versions/agents`는 `key`, 정수 `version`, `provider`, `description`을 받는다. 공급자는 `synthetic`, `ollama`, `openai-compatible`이다. 설명은 300자 이하다. 이 버전은 고정 시나리오 실행 공급자와 설명을 고정한다. 임의 URL·코드·프롬프트 또는 외부 공급자 설정을 저장하는 범용 에이전트 정의는 아니다. 실제 로컬 모델과 호출 한도는 기존 운영자 공급자 프로필을 사용한다.

`POST /api/versions/datasets`는 `key`, 정수 `version`, `cases`를 받는다. 사례는 `id`, `scenario`, 실제 Boolean `required`를 갖는다. 시나리오는 `pass`, `block`, `missing_evidence`, `error`만 허용한다. 사례 ID가 중복되면 거부하고, 적어도 하나가 필수여야 한다. 사례 순서는 내용 해시에 포함된다.

이름은 영문 소문자로 시작하는 3~64자의 소문자·숫자·하이픈이며 버전은 1~1,000,000이다. Java가 정렬된 JSON의 UTF-8 바이트 SHA-256을 저장한다. 같은 조직·프로젝트·이름·버전에 같은 내용을 다시 보내면 같은 UUID를 반환한다. 다른 내용이면 `409`다. DB API 역할에는 버전, 캠페인, 사례 결합, 검토의 UPDATE·DELETE 권한을 주지 않는다. 다른 조직·프로젝트의 UUID는 조회·실행에 사용할 수 없다.

각 프로젝트에 종류별 최대 200개 버전과 최대 200개 캠페인을 보관한다. 목록은 최근 50개이며 UUID로 개별 조회할 수 있다. 합성 캠페인은 1~8개 사례, 로컬 공급자는 최대 2개다. 한도는 자동 삭제나 숨겨진 데이터 교체로 회피하지 않는다.

## 캠페인과 현재 정책 판정

`POST /api/campaigns`는 `agentVersionId`, `datasetVersionId`, Boolean `requiresApproval` 및 8~100자의 `Idempotency-Key`를 받는다. 부모와 모든 사례 실행은 한 트랜잭션에서 저장된다. 같은 키·같은 요청은 같은 캠페인을 반환하고, 키를 다른 요청에 재사용하면 `409`다.

부모는 두 버전 UUID와 내용 해시를 보관한다. 워커 메시지·예약·완료에는 캠페인 UUID, 사례 ID, 에이전트 버전 UUID, 데이터셋 버전 UUID를 모두 결합한다. 누락·부분 결합·치환된 완료는 결과를 저장하지 않는다. 기존 단일 평가 메시지는 별도 계약으로 계속 처리한다.

캠페인 사례는 기존 2분의 DB 시각 기준 처리 기한과 영속 재전달을 사용한다. 로컬 호출은 사례마다 1회 예약·시간 제한을 적용한다. 콜드 스타트나 직렬 실행 때문에 기한을 넘길 수 있으며, 이때 늦은 성공으로 실패를 덮어쓰지 않는다. 최대 2개 사례 제한은 모든 로컬 캠페인의 성공을 보장하지 않는다.

사례가 대기 중이면 전체는 대기·판정 보류다. 실행 실패가 있으면 전체는 실패·판정 보류다. 실행이 모두 끝난 경우 필수 사례의 실패는 차단, 필수 증거 누락은 판정 보류다. 모든 필수 사례가 통과하면 선택 사례의 규칙 실패는 전체 통과를 뒤집지 않는다. 선택 사례의 **실행 오류**는 전체를 판정 보류로 만든다.

`GET /api/campaigns/{id}/gate`는 실제 OPA 정책 버전·바이트 해시와 최신 관리자 검토를 확인한다. 승인 필요 캠페인은 통과 결과만으로 허용되지 않는다. `POST /api/campaigns/{id}/reviews`의 승인·반려는 현재 정책 버전·해시에 결합하고 기록을 덮어쓰지 않는다. 실패·증거 누락·실행 오류 캠페인의 승인 시도는 `409`다. 개별 사례의 승인은 부모 캠페인의 승인이 아니다.

게이트는 아직 **서명되지 않은 현재 조회**다. 실제 배포를 실행하지 않는다. 이미지 Cosign 공급망 서명은 사업 평가 게이트의 Ed25519 서명을 대신하지 않는다.

## 회귀 비교의 범위

`GET /api/campaigns/{candidate}/comparison/{baseline}`은 같은 조직·프로젝트, 같은 에이전트 이름, 정확히 같은 데이터셋 버전 UUID·해시의 서로 다른 캠페인을 비교한다. 대기 중 또는 다른 데이터셋·에이전트 이름이면 `409`다. 필수 사례의 통과→차단은 새 실패, 차단→통과는 개선으로 기록한다. 실행 오류·미확인 필수 사례는 판정 보류다. 결과는 항상 `deploymentAuthority: false`이며, 비교만으로 승인이나 배포 권한이 생기지 않는다.

고정 시나리오 계약의 사례 상태 비교다. 범용 모델 품질 점수, 임의 프롬프트 데이터셋, 변경 임계치, 회귀 기준을 필수로 하는 최종 릴리스 정책은 후속 작업이다.

## 검증과 남은 범위

```powershell
python scripts/stack-campaign-smoke.py
python scripts/stack-campaign-recovery.py
python scripts/stack-campaign-recovery.py --deadline
# 공급자 프로필이 준비된 경우 실제 로컬 모델 4회 실행
python scripts/stack-campaign-model-smoke.py
npm --prefix apps/console test
npm --prefix apps/console run typecheck
```

검증은 새 스택의 합성 업무 데이터를 만들며 자체 세션만 종료한다. 복구 검증은 새 `stack-ai-worker`만 일시 정지·복구한다. 기존 API·DB와 LogiTrack은 수정하지 않는다. 비밀·모델 원문·브라우저 화면·쿠키를 결과 JSON에 기록하지 않는다.

MinIO에는 기존 계약으로 각 자식 실행의 정확한 평가 근거 바이트를 보관한다. 캠페인 부모와 버전은 PostgreSQL에 결합되어 있다. 캠페인 전체의 버전 결합을 포함하는 오프라인 보관본·사업 게이트 서명·운영 보존 정책은 아직 구현하지 않았다. 실제 고객 데이터, 유료 OpenAI 호출, 운영 클러스터 배포 검증을 했다고 주장하지 않는다.
