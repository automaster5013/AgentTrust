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
python scripts/stack-campaign-evidence-test.py
python scripts/stack-campaign-archive-smoke.py
# 공급자 프로필이 준비된 경우 실제 로컬 모델 4회 실행
python scripts/stack-campaign-model-smoke.py
npm --prefix apps/console test
npm --prefix apps/console run typecheck
```

검증은 새 스택의 합성 업무 데이터를 만들며 자체 세션만 종료한다. 복구 검증은 새 `stack-ai-worker`만 일시 정지·복구한다. 기존 API·DB와 LogiTrack은 수정하지 않는다. 비밀·모델 원문·브라우저 화면·쿠키를 결과 JSON에 기록하지 않는다.

MinIO에는 각 자식 실행의 기존 schema 1 보관본과 부모의 schema 2 보관본을 함께 저장한다. 부모는 실제 에이전트·데이터셋 내용과 두 SHA-256, 각 자식의 정확한 보관 해시·바이트 수·저장 버전을 결합한다. 부모도 같은 7일 COMPLIANCE 잠금을 적용하며 다른 버전의 shadow가 생겨도 고정된 원본을 읽는다. 부모는 평가 완료 뒤 고정되고 현재 승인·반려를 포함하지 않는다. 승인 변경은 보관 해시를 바꾸지 않는다. 화면의 **캠페인 보관 근거 확인**은 부모와 모든 자식의 바이트 해시를 브라우저에서 계산한다.

`GET /api/campaigns/{id}/evidence`가 제공하는 증거는 배포 권한을 만들지 않는다. 저장소 장애 중에는 검증된 보관본을 반환하지 않는다. `scripts/stack_campaign_evidence.py --bundle <inputs 폴더> --organization <조직 UUID> --project <프로젝트 UUID> --campaign <캠페인 UUID> --expected-parent-sha256 <별도로 확인한 부모 SHA-256>`은 네트워크 없이 부모·자식 보관본을 검사한다. 합성 통합 검증의 비공개 inputs 폴더에 번들이 생성된다. 이 단계의 SHA-256 확인은 디지털 서명이나 현재 릴리스 허용을 증명하지 않는다. CLI는 `signatureVerified: false`, `currentDeploymentAuthority: false`를 명시한다. 운영 게이트의 신뢰키 수명주기·보존 정책은 후속 작업이다. 실제 고객 데이터, 유료 OpenAI 호출, 운영 클러스터 배포 검증을 했다고 주장하지 않는다.


## 서명된 과거 판정과 현재 권한의 분리

선택 사항인 `compose.stack.signing.yaml`은 **개발용 Ed25519 서명 기록**을 활성화한다. 기본 설정은 비활성화다. MinIO 보관 구성이 먼저 필요하다. `docker build --target gate-keys -t agenttrust-gate-key-tool:local services/core-api`와 `python scripts/stack-gate-signing-setup.py`가 전용 비공개 폴더에 한 키를 준비한다. 기존 키를 덮어쓰지 않고, 비밀키를 환경 변수·로그·Git·CI artifact로 내보내지 않는다. 준비 표식이 있으면 스택 전용 스크립트가 서명 overlay를 사용한다. 직접 Compose를 실행할 때는 이 overlay를 명시해야 한다.

인증된 `GET /api/gate-trust`는 공개키·키 ID·개발용 신뢰 영역만 반환한다. 관리자는 완료되고 보관된 캠페인에 `POST /api/campaigns/{id}/receipts`, 메모 200자 이하, `Idempotency-Key`로 기록을 만든다. 서버가 당시 OPA 판정·최신 검토의 정책 버전/해시·평가 버전/내용 해시·정확한 부모/자식 보관 버전을 결합한 UTF-8 바이트에 서명한다. 정책 또는 보관 서비스가 없으면 새 기록을 만들지 않는다. 같은 키·같은 메모는 **당시 기록**을 그대로 반환하며, 새로운 현재 판정을 기록하려면 새 키를 사용해야 한다. 프로젝트당 최대 200개이며 조회·삽입만 허용하는 RLS 테이블에 저장한다.

조회자는 같은 프로젝트의 목록과 개별 기록을 읽을 수 있다. 화면은 Web Crypto로 실제 서명을 검증하고 **서명된 과거 판정**을 현재 게이트와 구분한다. 현재 반려 이후에도 과거 승인 기록의 서명은 유효할 수 있다. 이는 과거 바이트의 출처·무변조를 증명하는 개발용 증거이며 현재 허용을 뜻하지 않는다. 모든 기록과 검증 결과의 `currentDeploymentAuthority`는 `false`다. 실제 배포는 실행하지 않는다.

`python scripts/stack-campaign-receipt-smoke.py`는 합성 번들을 비공개 `.local/stack-campaign-receipt-*/inputs`에 저장한다. `node --experimental-strip-types scripts/stack-verify-campaign-receipt.ts --bundle <inputs> --trusted-public-key <별도로 신뢰한 public-key.pem> --organization <UUID> --project <UUID> --campaign <UUID>`는 네트워크 없이 서명과 부모 보관 해시·버전 결합을 검증한다. 번들에 포함된 키를 자동 신뢰하지 않는다. 부모/자식 **실제 보관 바이트 전체**는 위 Python 검증기를 함께 실행해야 한다. Node 결과는 이 차이를 `childBytesVerified: false`로 명시한다. 브라우저의 키 출처는 인증된 서버이며 독립된 외부 신뢰 체계는 아니다.

이는 개발용 단일 키와 과거 판정 관찰 기록이다. 운영 KMS/HSM, 키 교체·폐기/유효 기간, 서명된 **현재 배포 토큰**, 회귀 기준 강제와 실제 배포자의 권한 검사는 아직 구현하지 않았다. 키가 달라지면 기존 기록의 서버 검증은 실패하며 자동으로 새 키를 신뢰하지 않는다. 기존 JavaScript 서명 기록의 이전도 완료했다고 표시하지 않는다.
