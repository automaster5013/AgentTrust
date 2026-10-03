# 로컬 개발과 API 계약 — v0.2

## 시작과 정지

Node.js 24와 실행 중인 Docker Desktop이 필요하다. 모든 명령은 C:\AgentTrust에서 실행한다.

```powershell
Set-Location C:\AgentTrust
npm.cmd ci --cache .cache/npm --ignore-scripts
npm.cmd run setup
npm.cmd run docker:up
```

화면: http://127.0.0.1:4310. 접근 키는 `.local/credentials.json`의 첫 조직에서 admin/editor/viewer 역할에 맞는 token을 복사해 로그인한다. 두 번째 조직은 격리 확인용이다. 키는 화면에 표시하거나 저장소에 커밋하지 않는다. 로그인 입력은 성공 후 지우고 세션은 HttpOnly·SameSite=Strict 쿠키로 유지한다.

setup은 없을 때만 `.env`와 로컬 키를 생성하고 마이그레이션을 적용한다. 반복 실행은 기존 데이터와 키를 보존한다. `.env`와 `.local`은 현재 Windows 사용자와 SYSTEM으로 접근을 제한한다(Unix에서는 0600/0700). 두 경로를 잃으면 기존 DB 비밀번호·접근 키가 자동 복구되지 않으므로 안전한 장소에 함께 보관한다. `.env.example`을 그대로 복사하는 대신 setup으로 실제 설정을 생성한다.

```powershell
# 데이터와 이미지를 보존하며 AgentTrust만 정지
npm.cmd run docker:stop
# 다시 시작
npm.cmd run docker:up
```

Compose 프로젝트는 agenttrust이며 DB 볼륨은 agenttrust_postgres-data다. API의 호스트 포트는 4310, DB의 호스트 포트는 55432이고 둘 다 루프백에만 공개된다. 워커는 공개 포트가 없다. Node/PostgreSQL 이미지는 검증한 digest로 고정했다. 이미지 갱신은 별도 검증 후 진행한다.

## 개발과 검증

```powershell
npm.cmd run check
npm.cmd test
npm.cmd audit --cache .cache/npm
```

setup은 운영 개발용 agenttrust DB와 별도의 agenttrust_test DB를 준비한다. 테스트는 _test DB만 사용하고 합성 조직을 생성한다. 현재 테스트 기록은 이 DB에 남는다. 실제 DB·사용자 자료를 테스트 URL로 지정하지 않는다.

API/워커를 호스트 Node로 디버깅하려면 Docker의 api/worker만 정지한 뒤 각각 npm.cmd start와 npm.cmd run worker를 실행한다. DB 컨테이너는 유지한다. 동일 4310 포트에 Docker API와 호스트 API를 동시에 실행하지 않는다.

Docker 재시작 검증: `node --env-file=.env scripts/smoke.mjs before` → AgentTrust 컨테이너만 정지/재시작 → `node --env-file=.env scripts/smoke.mjs after`. 합성 평가를 저장하고 이후 결과 해시·스냅샷·사용량·완료 감사 이벤트를 비교한다.

## 인증과 역할

로컬 개발용 임의 접근 키는 256비트이며 DB에는 SHA-256 해시만 저장한다. 세션도 해시로 저장하고 8시간 후 만료한다. 계정 비활성화 또는 키 폐기 상태를 매 요청에 검사한다. 로그인 실패는 1분당 20회, 키당 활성 세션은 20개로 제한한다. 이 로그인 제한은 API 프로세스 단위다.

조회자는 자기 조직 결과·버전·사용량을 조회한다. 작성자는 데이터셋·에이전트 버전 생성, 실행·취소가 가능하다. 관리자는 정책 버전 생성과 감사 기록 조회도 가능하다. 조직은 로그인한 멤버십에서 결정하며 요청의 조직 헤더로 바꿀 수 없다. 초기에는 조직당 기본 프로젝트 하나를 사용한다.

DB API 역할은 소유자 권한과 BYPASSRLS가 없으며 트랜잭션마다 조직 범위를 설정한다. 프로젝트·버전·실행·감사·사용량 테이블에 강제 RLS를 적용한다. 외래 키도 조직/프로젝트가 일치해야 한다. 워커는 전 조직 큐 처리를 위해 별도의 BYPASSRLS 역할을 사용하지만 실행·감사·사용량 테이블로 권한을 제한한다. DB 소유자는 마이그레이션/로컬 준비에만 사용한다.

## 실행과 API

인증: `POST /v1/auth/login`에 `{ "accessKey": "..." }`, `POST /v1/auth/logout`에 `{}`, `GET /v1/me`.
인증 없이 정적 화면과 GET /health만 접근할 수 있다. 나머지 데이터 API는 세션을 요구한다.

조회: GET /v1/catalog, /v1/sample-dataset, /v1/runs, /v1/runs/{id}, /v1/runs/{id}/results, /v1/runs/{id}/gate, /v1/audit-events(관리자), /v1/usage.
생성: POST /v1/agent-versions, /v1/dataset-versions, /v1/policy-versions(관리자), /v1/runs.
취소: POST /v1/runs/{id}/cancel에 {}.
모든 POST는 Content-Type: application/json과 X-AgentTrust-Request: local-ui를 요구한다. 커스텀 헤더는 인증 자격이 아니다.

실행 본문은 agentVersionId, datasetVersionId, policyVersionId와 선택 timeoutMs(기본 30000, 100~120000), caseBudget(기본 100, 1~100), maxAttempts(기본 3, 1~5)를 받는다. Idempotency-Key는 8~100자의 영문·숫자·하이픈·밑줄이다. 조직/프로젝트 안에서 같은 키와 같은 요청은 동일 실행을 반환하고, 다른 요청 재사용은 409다. JSON 키 순서나 기본값 생략은 동일 요청으로 처리한다.

평가 요청은 버전 스냅샷과 함께 트랜잭션으로 저장된다. 독립 워커는 SKIP LOCKED로 작업을 점유하고 5초 lease를 갱신한다. 죽은 워커의 lease가 만료되면 다른 워커가 재시도한다. 이전 시도의 lease token은 결과 확정에 사용할 수 없다. 모든 종료 결과·사용량·감사 이벤트를 한 트랜잭션으로 확정한다.

시간 예산은 큐 대기 시간부터 계산한다. 워커가 없으면 대기 작업의 시간 초과 확정은 워커가 다시 실행될 때 수행되며 그동안 게이트는 닫혀 있다. 취소는 즉시 DB 상태를 확정하고 늦은 결과를 거절한다. 사례 예산을 초과하면 실행을 실패로 종료한다. 사용량은 시도 횟수와 확정된 결과 사례 수를 나타내는 모의 계량이며 실제 모델 비용/청구는 아니다.

queued → running → succeeded/failed/cancelled/timed_out. queued에서 직접 취소·시간 초과도 가능하다. 필수 규칙 실패는 block, 오류·누락·취소·시간 초과는 inconclusive이며 이미 확인한 필수 실패는 block을 유지한다. pass만 배포 허용으로 해석한다. 실행 성공과 게이트 통과는 별도다.

## 입력과 평가 규칙

모의 mode는 compliant, regression, forbidden_tool, error, missing_evidence, unsafe_output, slow다. slow는 2.5초 합성 지연으로 취소/시간 초과를 확인한다. 실제 외부 도구는 호출하지 않는다.

규칙: contains/not_contains(value), json_schema(schema), allowed_tools(allowed 및 선택 argumentSchemas). required 생략은 필수이며 사례당 최소 한 개가 필요하다. JSON Schema는 type, properties, required, additionalProperties(boolean), items, enum, minimum/maximum, minLength/maxLength, minItems/maxItems만 허용한다. 스키마 깊이 6·속성 30·enum 30으로 제한하고 참조·정규식·외부 스키마·format은 거절한다.

요청 256 KiB, 100개 사례, 사례당 규칙/도구 이벤트 20개, 문자열 10000자, 입력 중첩 16·노드 30000으로 제한한다. 조직당 버전 1000개, 실행 10000개, 미완료 실행 10개다. 목록/감사는 최근 100개를 반환한다. 원문은 합성 데이터만 입력한다.

## 현재 경계

루프백 전용 HTTP 개발 환경이며 쿠키의 Secure 속성은 사용하지 않는다. TLS+Secure 쿠키, OIDC/SSO, 운영용 계정/키 관리, 공유 로그인 제한, 외부 어댑터, 프로젝트별 역할, 보존·삭제·백업 복원, 실제 요금 계량, 배포 승인 예외/CI 배포 연결은 이후 단계다. 실제 모델 호출과 임의 코드 실행 샌드박스는 없다. 워커의 평가 스레드는 자원 제한용이며 비신뢰 코드를 실행하는 보안 샌드박스가 아니다.

결과 해시는 디지털 서명이 아니다. 감사 행은 API/워커 역할에 대해 추가만 가능하며 DB 소유자까지 막는 WORM 저장소는 아니다. 데이터 원문은 PostgreSQL에 저장되므로 상용 배포 전 암호화·보존·삭제 정책을 검증해야 한다. TypeScript 전환은 아직 수행하지 않았다.

참고: [PostgreSQL 작업 잠금](https://www.postgresql.org/docs/17/sql-select.html), [node-postgres 트랜잭션](https://node-postgres.com/features/transactions), [Compose 프로젝트 분리](https://docs.docker.com/compose/how-tos/project-name/).

선택 버전 조회: `GET /v1/versions/:id`는 현재 조직·프로젝트의 버전만 `{id,kind,data,contentHash,createdAt}`로 반환한다. 조회자도 읽을 수 있으며 다른 조직/프로젝트는 404다. 저장된 원문 해시가 불일치하면 정상 버전으로 반환하지 않는다. `/v1/catalog`은 이름·사례 수·정책 통과율/관리자 검토 여부·생성 시각·해시 등의 요약만 DB에서 읽으며 데이터셋 원문 전체를 목록에 가져오지 않는다.

평가 설정 아래 내용 버튼으로 선택한 에이전트·데이터셋·정책 원문과 해시를 확인할 수 있다. 데이터셋 불러오기는 선택 버전의 원문을 복사 이름의 편집 초안으로 불러온다. 등록하면 새로운 ID와 해시를 가진 불변 버전을 만들며 기존 실행의 스냅샷은 바꾸지 않는다. 불러오기 응답을 기다리는 동안 초안이 수정되면 덮어쓰지 않는다. 늦게 도착한 버전 조회 응답은 선택 버전/워크스페이스가 바뀌면 표시하지 않는다.

저장된 버전은 원문 조회와 실행 스냅샷 생성 전에 contentHash와 계약을 다시 검증한다. 저장된 JSON이 계약을 위반하거나 해시가 다르면 비밀 없는 503으로 거부하고 실행/감사를 만들지 않는다. 소유자 권한으로 만든 손상 합성 fixture에서도 이를 검증한다. 기존 신규 실행의 queued/attempts=0/outcome 없음 제약에 더해 lease·시작/완료 시각·result_hash도 없도록 DB insert 경계를 강화했다. 워커의 정상 claim·완료와 API 취소는 기존 경로를 유지한다.

증거 JSON Schema 컴파일은 canonical 원문이 같은 스키마를 재사용한다. 캐시는 LRU 128개와 직렬화 원문 256 KiB 이내로 제한하며, 컴파일 입력을 복제·동결하여 호출자가 원문을 바꿔도 캐시 동작이 바뀌지 않는다. 이 한도는 전체 JavaScript heap 크기의 보장이 아니며 워커는 별도의 96 MiB 실행 한도를 유지한다. 데이터셋은 출력 스키마와 도구 인자 스키마를 합쳐 서로 다른 스키마 최대 128개를 허용한다. 반복 스키마는 한 번 검증/컴파일하고 다른 규칙에서 재사용한다. 지원하지 않는 키워드는 캐시 조회 전에도 거부한다.

로컬 합성 측정: 50사례·500규칙이 동일 스키마를 사용하는 85,687바이트 데이터셋 검증은 변경 전 1,818 ms, 변경 후 19 ms였다. 단일 로컬 실행 측정이며 다른 장치나 고객 워크로드의 성능 보장은 아니다. 캐시 재사용·호출자 변경 격리·오류 초기화·LRU/원문 예산·128개 스키마 경계를 테스트한다.

실제 Docker API/독립 워커에서도 50사례·500규칙의 합성 데이터셋을 등록하고 500규칙 PASS를 확인했다. 이 장치에서 등록 요청 64ms, 완료 관찰 271ms, 직후 health 요청 4ms였다. 결과 측정은 .local/schema-benchmark.json에 보존하며 이는 단일 합성 측정이다.

화면 응답 순서 보호: 취소 요청은 클릭한 실행 ID를 고정하고 이후 다른 실행을 선택하면 취소 응답으로 근거 패널을 바꾸지 않는다. 후보/기준 변경 후 이전 비교 응답은 무시한다. 동일 실행을 다시 선택해도 이전 polling 세대는 종료하며 확정된 종료 상태를 대기/실행 상태로 되돌리지 않는다. CI 키/검증 기록과 관리자 검토 새로고침도 이전 응답을 무시한다. 검토 제출 중에는 새로고침이 승인/반려 버튼을 다시 활성화하지 않는다. 실제 app.js를 지연 HTTP 응답과 최소 DOM 모델에서 실행해 6가지 경합을 검증했다. 변경 전 소스에서는 최초 4가지 회귀 테스트가 모두 실패했고 변경 후 통과했다. 이 테스트는 브라우저 레이아웃 검증을 대체하지 않는다.

### Request admission (v0.24.0)

Dynamic API and health requests share a per-process limit of 32 concurrent handlers (injected test limits must be integers from 1 to 64). Excess requests receive 503 with Retry-After: 1 before database access or body parsing. Static login assets remain available. TCP connections are capped at 128. This is local process protection, not a distributed tenant rate limit.

An admitted slot remains occupied until both handler work settles and the response finishes or closes. Disconnecting a client cannot release capacity while its database work is pending. Authorized mutations may finish after disconnection; retry with the existing idempotency key where supported. Response finish reflects transmission to the operating system, not proof of client receipt.

Dynamic requests with Sec-Fetch-Site accept only same-origin or none; same-site, cross-site and unknown values are rejected before database access. Headerless native clients remain supported. Existing exact Origin and loopback Host checks remain in force. Fetch Metadata supplements authentication and does not authenticate native clients.

### Repeated setup retention (v0.25.0)

Setup creates sample organizations and versions only when the database contains no organizations. Existing projects, including intentionally empty projects, receive no additional sample versions on repeated setup. Existing access keys are never regenerated. An empty database with a pre-existing credentials file is rejected before seeding; restore the matching database and credentials together. The completion message resolves the actual credentials path on Windows and Unix. Local validation compared all stored versions and the credentials-file digest before and after running setup again; both were unchanged.

### Concurrent login protection (v0.26.0)

The per-process 20-failure/minute login budget also reserves capacity for pending credential checks. Parallel requests cannot all pass the budget check before their database lookup returns. A completed authentication rejection records its completion time; success and database errors release the reservation without adding an invalid-credential failure. A burst of legitimate logins can receive 429 while other checks are pending; retry once they complete. This limit is process-local and shared across credentials. Controlled concurrent tests verify exactly 20 unknown-key lookups, rejection of the next request before DB access, and reservation recovery after database errors.

### Atomic initial bootstrap and credential journal (v0.27.0)

Initial sample organizations, memberships, credentials and versions are created in one transaction protected by a setup advisory lock. A failure creating the second organization rolls back the first. Before commit, generated access keys are written exclusively to the private credentials.json.pending journal. After commit, a same-directory hard link publishes credentials.json without overwriting an existing file, then removes the journal. The private directory permissions are restricted before generating signing keys or journals; .env permissions are restricted before loading it.

If the database committed but its acknowledgement or file promotion failed, the next setup validates journal structure, both organization/project relationships, all six credential hashes, membership roles and active/revocation states before recovering the credentials file. If neither journal organization nor credential exists in the database, the rolled-back journal is replaced by a fresh bootstrap. Partial or mismatched state is preserved and rejected for private recovery review. An existing credentials.json is always retained. Concurrent promotion accepts only an already published file with identical bytes.

Five controlled failure tests cover atomic success, second-organization rollback, ambiguous commit recovery, credential-hash mismatch and a fully rolled-back journal. An actual isolated PostgreSQL database was also tested: commit acknowledgement loss, recovery on retry, and successful administrator login in both organizations. The isolated database and private recovery artifacts are retained. This is a local installation recovery mechanism, not a substitute for backing up .env, .local and the database together.
