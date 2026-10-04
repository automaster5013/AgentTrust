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

로컬 개발용 임의 접근 키는 256비트이며 DB에는 SHA-256 해시만 저장한다. 세션도 해시로 저장하고 8시간 후 만료한다. 계정 비활성화 또는 키 폐기 상태를 매 요청에 검사한다. 로그인 실패 및 진행 중 인증 예약은 API 프로세스별 1분당 20회 예산을 공유한다. 성공 로그인은 DB 기준 키당 1분에 20회, 조직당 120회로 제한하며 로그아웃이나 API 재시작으로 초기화되지 않는다. 키당 활성 세션도 20개로 제한한다.

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

### JSON encoding and persistence boundaries (v0.28.0)

API JSON bodies and HTTPS evidence responses use fatal UTF-8 decoding. Invalid encodings, numeric overflow to Infinity, NUL characters and unpaired UTF-16 surrogates are rejected before authentication lookup for login bodies or before version/evidence persistence. Object property names receive the same Unicode checks. Valid Korean text, paired emoji, ordinary escapes and finite large numbers remain supported. The shared iterative inspection retains the depth-16 and 30,000-node budgets. This avoids silently replacing invalid bytes, collapsing non-finite values to null during serialization, or surfacing JSONB encoding failures as infrastructure errors. Four tests cover raw bytes, nested version values, external evidence and the native HTTP admission path.

### Stored rule truth verification (v0.29.0)

Live release gates and baseline comparisons validate the snapshot version contracts and recompute every rule status from the stored output/tool evidence. Rebasing result hashes, pass counts and gate fields cannot turn failing output, forbidden tools, invalid structured output or invalid tool arguments into a valid pass. Adapter-error cases must retain inconclusive rule statuses. Informational reason strings are not recalculated for equality. Historical signed receipts remain historical records. No agent or external endpoint is called; this does not independently prove the origin of stored output or defend against an operator replacing all source data and evidence with a different self-consistent execution. The original database/worker/source-version trust boundary remains. A private regression demonstration confirms the previous integrity check accepted a forged pass with failing evidence while the current check rejects it.

Actual HTTP/database integration also submitted an inconsistent completed worker outcome and confirmed a persisted BLOCK release receipt. A fresh 50-case/500-rule Docker evaluation retained PASS with independently verified Ed25519 receipt; observed evaluation completion was 353 ms and live gate verification/signing was 71 ms in one local measurement (not a throughput guarantee).

### Login session management (v0.30.0)

GET /v1/sessions returns active session metadata in pages (default 25, maximum 100). Administrators see their organization; other members see only their own sessions. Public random UUIDs, member name/role, createdAt/expiresAt and a current-browser flag are returned; access tokens, token hashes and credential IDs are omitted. Cursors bind tenant, project and role/member visibility. Session scope is organizational even when the current project changes.

POST /v1/sessions/:id/revoke accepts only an empty JSON object. Members may terminate their own sessions; administrators may terminate sessions in their organization. Foreign or unauthorized session IDs return 404. Terminating the current session clears its cookie. DELETE acquires the row lock using existing minimal privileges; authorization is revalidated after waiting, with a dedicated credential/member/expiry check for the deleted current session. Loss of administrator role or expiration during a lock wait rolls the deletion back. A committed termination emits exactly one auth.session.revoked audit record. Revocation of a session does not revoke its access key or invalidate historical administrator reviews; the key can log in again. This is local-key session management, not SSO or account lifecycle management.

The session panel shows active sessions and supports termination, with sequence guards against stale lists and disabled controls while a termination is pending. Four native HTTP/database tests cover scope, token secrecy, self cookie clearing, paging/cursor visibility and authorization changes during real lock waits. Two additional UI race tests exercise the actual app source. Existing sessions are assigned public UUIDs by migration 019; only new indexes and that identity column are added.

### Gate validation reuse within one request (v0.31.0)

A synchronous release/comparison call verifies each run object once and reuses that result for self-coverage and baseline checks. The WeakMap lives only inside that call; a later request, including the same object after mutation, is fully checked again. Coverage membership uses a Set rather than repeatedly scanning an array. No persistent authorization cache or caller-supplied verification override is introduced. A regression test mutates the same run after successful release/comparison and confirms both later calls reject it. For the same 500-rule stored run, 12 warmed interleaved local samples measured 23.43 ms mean before and 9.02 ms after for the pure release function, excluding network/database/signing. These measurements do not establish production throughput or p95 targets.

A single current-Docker burst interleaved 20 authenticated metadata reads with 10 signed 500-rule gate checks (30 concurrent requests). All returned HTTP 200, all gate decisions were PASS and all signatures verified against the separately stored public key. Metadata p95 was 157 ms and the slowest gate response was 372 ms. This small synthetic burst is a smoke test, not a sustained-load or production SLO claim.

### Worker completion verification and final-write fencing (v0.32.0)

The parent worker verifies the child outcome before storing it: exact outcome fields, finite/storeable JSON, case budget, version/snapshot binding, per-rule truth, summary and gate. Malformed or inconsistent evidence is replaced by a generic failed/inconclusive outcome with no result cases; it cannot display as an application-generated PASS or add invalid evaluated-case usage. Bounded empty worker failures remain supported. The evaluator thread checks the aggregate outcome before transferring it to the parent: at most 60,000 nodes and depth 16. This is separate from the unchanged request/dataset limit of 30,000 nodes and allows result metadata added to legal near-budget inputs. Oversized aggregate remote evidence can therefore fail the run even if each individual response meets its own limit. Array/property counts are checked before queuing all child nodes.

Completion is finalized by a conditional database UPDATE using one materialized current timestamp for the lease predicate, deadline decision and completedAt. Expired leases cannot complete, including when a row lock or database delivery delay crosses the lease boundary. A still-leased run past its deadline stores timed_out with matching result hash. Usage/audit are recorded only if that conditional write succeeds. Existing sweep/cancel paths retain their state-specific logic.

Native regressions demonstrate that the previous completion path accepted a pass after a row-lock wait outlasted its lease. Tests now verify lease recovery with attempts=2, deadline timeout after waiting, delayed delivery of the final write, quarantined worker evidence, and preservation of valid large outcomes. The independent CI corruption test deliberately uses direct trusted-worker DB completion to confirm the API gate still rejects inconsistent evidence even if the application worker guard is bypassed. No database permission is widened.


### Successful-login churn and credential binding (v0.33.0)

Successful logins are limited to 20 per access key and 120 per organization in a rolling 60-second database window. Credential and organization advisory locks make this shared limit atomic across concurrent API instances; recent immutable auth.login audit records supply the count. Signing out or restarting the API does not reset it. Login audit timestamps use the actual insertion clock, so time spent waiting for a lock cannot backdate a new success out of its rate window. Existing process-local invalid-attempt/pending reservations and the 20-active-session limit remain separate bounds. These limits slow authenticated session/audit churn; they do not implement retention or a total audit-storage quota.

After both locks, the access-key lookup must still match the original credential UUID, membership UUID and organization. Revocation or rebinding during the wait returns 401 before creating a session or audit event. Tests exercise real organization-lock waits with revocation and a same-organization token-hash reassignment, logout/restart-resistant quotas, tenant isolation and bounded configuration. Trusted DB administrators remain outside the adversarial boundary.


### Bounded evidence browsing (v0.34.0)

The case evidence panel renders ten cases at a time and offers case-ID/input substring search plus rule-status filters: any failure, inconclusive/error, or all rules passed. Each matching case keeps its complete rules and evidence; long text/tool JSON scrolls inside its evidence block. Filters affect only the visible cards. Whole-run summary, deployment decision and JSON export stay unchanged. Search resets the page; selecting another run or clearing the workspace resets search/filter/page; refreshing the same run retains the page within the available range. Native UI tests cover pagination boundaries, mixed rule/error evidence, no matches, workspace clearing and full-result export while filtered.

Actual Docker execution of a 138,651-byte synthetic dataset containing 100 cases and 2,000 rules completed as PASS. Dataset registration took 47 ms, observed evaluation completion 503 ms and trusted-public-key signed gate verification 64 ms in one local sample. These are synthetic observations, not production performance guarantees.


### CI credential authorization after row locking (v0.35.0)

A release check first acquires a scoped SHARE lock on its project CI credential, then executes a new statement to check revocation, current expiry and the issuer's active administrator role. A time predicate in the locking statement could be evaluated before its lock wait; a native regression reproduced an expired credential receiving HTTP 200 and a PASS receipt under the old query. The new post-lock statement rejects expiry, concurrent credential revocation, issuer role loss and issuer deactivation with 401 before recording a check. The credential lock remains held through the transaction to serialize concurrent revocation. No membership UPDATE or broader database privilege is granted.

The same revalidation applies before replaying an existing idempotent receipt. Expiration during a real row-lock wait rejects that replay while preserving the original immutable historical artifact; reading past evidence remains separate from requesting a current authorization check. These checks establish authorization at the post-lock check point, not a portable long-lived deployment token or immunity to trusted database operators.


Manual-review actor validity is likewise read after credential/session lock waits. The run's review lock still serializes new approvals/rejections, but membership role/activation can change independently. A second native regression reproduced a cached administrator approval remaining PASS after the separate reviewer lost administrator role while the CI request waited on its credential row. Refreshing the latest review after all authorization locks now produces a signed BLOCK with manualApproval.status=invalid. The reviewer is separate from the CI key issuer in this test.


### Administrator approval verifies evidence truth (v0.36.0)

Creating an approved manual review requires both a completed passing evaluation and full runIntegrity verification: immutable version/snapshot binding, result hash, exact case/rule coverage, stored evidence re-evaluation, summary and policy gate. A regression deliberately bypasses the application worker through the trusted DB worker role and stores a nominal PASS whose answer contradicts a required rule. Previously the review API accepted an approval even though the CI gate independently blocked the evidence; it now returns 409 without adding a review. An administrator may still record a rejection of that terminal evidence. Review idempotency preserves historical opinions and does not turn them into current deployment permissions. This adds defense at the approval workflow; it does not prove model-output origin or make a compromised database operator untrusted.


### Diagnostic and serialized-result budgets (v0.37.0)

JSON Schema failure reasons include at most the first five AJV errors and 2,000 UTF-16 code units, with the total violation count when additional errors are omitted. Truncation preserves well-formed Unicode; source output and failed rule statuses remain unchanged. One legal case with twenty rules and a 100-element invalid array previously repeated thousands of detailed errors into every rule reason. Tests preserve its twenty required failures and BLOCK decision while bounding the diagnostics.

Aggregate outcomes also have an 8 MiB limit on serialized UTF-8 JSON, independent of the existing 60,000-node/depth-16 limits. The thread checks before transfer, the parent checks before storage, and stored-evidence verification checks before authorizing a release or administrator approval. Excess aggregate bytes produce the existing generic failed/inconclusive empty outcome; huge strings cannot bypass a node-count-only limit. Per-response HTTPS limits still apply independently. The worker's 96 MiB thread heap limit remains a backstop; the result-size check runs after evaluation and is not a hard process-RSS limit.


For the same 29,378-byte synthetic dataset (one case, twenty schema rules, 3,000 violations per rule), a local before/after evaluation measured serialized outcome size 11,536,346 bytes versus 22,166 bytes, with the same twenty FAIL statuses and BLOCK gate. Maximum reason length fell from 510,701 to 882 code units. A single local pure-function sample took 71 ms versus 6 ms, excluding database/network/thread startup. Current Docker returned the full run, including its snapshot, in 52,908 bytes and verified a signed BLOCK receipt; observed evaluation-plus-gate completion was 358 ms. These are targeted synthetic measurements, not production throughput guarantees.


### Sequence-ordered manual-review pages (v0.39.0)

GET /v1/runs/:id/reviews accepts optional limit/cursor pagination (default 25, maximum 100). Without query parameters it retains the prior latest-50 array response. Pages use the monotonic bigint review_order, not createdAt, so later opinions with older wall-clock timestamps stay first. Cursor order is a decimal string to preserve values beyond JavaScript's safe integer range and is bounded to PostgreSQL bigint; cursor shape, tenant, project and run-specific scope are checked. New reviews arriving after page one do not duplicate or reorder the older continuation; refresh retrieves the latest page. The existing review-order index supports this range without a new migration.

The review panel offers older-record paging and retains sequence/run guards against late page responses or stale refreshes. Pending submissions keep approval/rejection/older-history controls disabled. Changing runs clears the cursor; an older submission error cannot replace the newly selected run's status. Native tests cover backwards clocks, concurrent insertion between pages, cross-tenant/project/run cursors, bigint precision, malformed parameters and UI races. Final gate ordering still uses the unchanged latestReview query.

Actual Docker created 52 synthetic rejection opinions for one passing manual-policy evaluation. Pages returned 25, 25 and 2 reviews in reverse insertion order, while the unpaged compatibility endpoint returned 50. The trusted-public-key signed final gate remained BLOCK/rejected. Browser paging reached 25, 50 and 52 rendered opinions and disabled further paging on the final page. The synthetic opinions are retained as immutable local test history.


### Workspace hydration and initial event registration (v0.40.0)

All form/button handlers are registered before the first awaited workspace initialization. A dedicated loading panel is shown while session/project reads hydrate the UI; interactive workspace controls remain hidden until catalog, history, sessions and audit data are ready. The initial login control stays disabled during the session check. Initialization failure clears partial workspace state and restores a usable login; a data-read failure after a successful login also leaves the loading state correctly. This prevents an early form submit from taking the browser's default navigation path while handlers are still being registered.

Three tests defer the first credential-history read, verify form handlers and preventDefault are already installed, and check both initial and post-login read failure recovery. Existing role, selection, pagination and asynchronous response guards remain tested. This is local UI readiness handling; it does not add a new login provider or permission.

Actual Docker browser verification showed only the loading panel during hydration and the workspace after completion. Submitting the history form kept the clean localhost URL without a default form navigation. All 136 tests and syntax checks passed.

### Bounded sustained local verification (v0.41.0)

The reusable smoke:sustained command executes nine synthetic runs per cycle across all mock modes, timeout and cancellation, checks two trusted-key signed decisions, and verifies scoped usage/case totals and exactly one terminal audit per run. Cycle count is limited to 1..30 and start interval to 1,000..60,000 ms; malformed, repeated, unknown or missing CLI options fail before authentication. Each invocation writes a unique private report and cleans up its own session and unfinished runs. It adds no new fixture versions, CI credentials or administrator approvals. Short two-cycle verification produced eighteen expected outcomes with no transient retries, exactly-once accounting and logout. Six invalid CLI combinations were rejected. The workflow includes the same short command; remote execution remains unverified.

## 화면 요청 시간 제한 — v0.68

화면 API 요청은 응답 본문 읽기를 포함해 15초 제한을 사용한다. 시간 초과는 실패로 표시하며 최종 게이트 통과·기록 저장으로 진행하지 않는다. 서버에서 생성·검토 요청이 이미 처리됐을 수 있으므로 기록 조회 후 재시도하도록 안내한다. 자동 재전송이나 서버 작업 취소를 추가하지 않는다. 평가 실행 자체의 timeoutMs 예산과 별개의 화면 요청 제한이다.

## 기존 운영 점검의 HTTP 경계 — v0.69

재시작·워커 복구·CI·관리자 검토·반복 평가 점검은 공통 로컬 HTTP 함수를 사용한다. PORT는 1024..65535의 정규 십진 문자열만 허용하며 비공개 설정 읽기 전에 확인한다. 대상은 HTTP 127.0.0.1이고 요청 경로로 origin을 바꿀 수 없다. 리디렉션을 따라가지 않으며 요청·본문 읽기는 최대 10초로 제한한다. 반복 점검의 기존 5초 제한은 더 짧은 신호로 유지한다. 실제 두 합성 서버로 307 전송 거절을 검증했으며 외부 고객 호출을 추가하지 않았다.

## 메타데이터 응답 시간 측정 — v0.70

`npm.cmd run benchmark:metadata -- --samples 20`은 로컬 합성 조회자 세션으로 `/v1/me`, `/v1/catalog`, `/v1/runs?limit=25`, `/v1/usage`를 순차 조회한다. 각 경로의 두 번 예열은 제외하고 1..100회(기본 20회)의 HTTP 요청과 JSON 본문 읽기 시간을 측정한다. p50/p95는 정렬된 표본의 nearest-rank 값이며 단위는 ms다. 동시 요청·평가 처리량·운영 SLA 측정이 아니며 통과 임계값을 두지 않는다. 데이터 크기, 실행 환경과 다른 로컬 작업에 따라 결과가 달라진다.

조회 대상은 메타데이터만 읽지만 로그인·로그아웃은 세션과 감사 기록을 생성한다. 평가 생성·승인·키 발급은 수행하지 않는다. 포트와 CLI 옵션은 비공개 설정 읽기 전에 검증하며 기존 점검의 루프백·리디렉션 거절·10초 요청 제한을 공유한다. 하나라도 실패하거나 로그아웃·보고서 저장이 실패하면 종료 코드 1과 blocked를 반환한다. 일부 측정 성공을 전체 통과로 표시하지 않는다.

고유 보고서는 `.local/metadata-benchmark-<UUID>.json`에 저장하며 키·쿠키·API 응답 본문을 포함하지 않는다. 실제 CLI 합성 서버 테스트는 조회 범위, 예열 제외, 비밀 미출력, 조회 실패 후 로그아웃, 로그아웃 실패 차단과 잘못된 옵션의 인증 전 거절을 확인한다. CI는 경로마다 5회로 명령 실행을 검증한다. 이 단계는 고객 연결이나 서버 배포를 추가하지 않는다.

## 취소 응답과 화면 선택 — v0.71

취소 요청은 시작 시 워크스페이스와 실행 선택 세대를 보관한다. 응답·검토 이력·실행 이력·감사 조회의 각 await 이후에도 같은 선택인지 확인하고, 다른 실행·같은 실행 재선택·로그아웃 이후에는 이전 요청의 결과나 오류를 표시하지 않는다. 서버에서 이미 수행한 취소를 되돌리거나 요청을 자동 재전송하지 않는다. 현재 선택이 유지된 취소 확인과 진행 중 polling의 종결 상태 보존은 기존대로 검증한다.

세 개의 실제 UI 핸들러 재현 테스트가 수정 전에 모두 실패했다. 늦은 성공이 새 선택의 메시지를 덮는 경우, 로그아웃 후 늦은 오류가 새 화면에 표시되는 경우, 같은 실행 재선택의 최신 완료 상태가 이전 취소 상태로 바뀌는 경우를 확인하고 수정 후 통과했다.

## 평가 생성과 화면의 실행 잠금 — v0.72

평가 생성 핸들러는 워크스페이스와 선택 세대를 보관한다. 생성 응답을 기다리는 중 명시적으로 다른 실행을 선택하면 이전 응답으로 선택을 바꾸지 않는다. 자체 실행 선택 후 polling이 끝나도 동일한 선택일 때만 완료·오류 메시지를 표시한다. 워크스페이스 초기화는 실행 잠금을 비우고 이전 워크스페이스의 finally는 새 요청 잠금을 해제하지 않는다. 실제 서버 실행을 자동 취소하거나 재전송하지 않으며 기록 조회로 결과를 확인할 수 있다.

두 UI 재현 테스트는 수정 전 새 로그인의 실행 버튼 잠금과 다른 실행 선택 후 잘못된 완료 메시지를 확인했다. 수정 후 새 요청 잠금 보존과 늦은 생성 응답의 명시적 선택 보존도 검증한다. 서버의 평가 멱등 처리·사용량·권한은 바꾸지 않는다.

## 시연 포트와 공통 전송 — v0.73

사전 점검·10단계 포트폴리오 시연·11단계 역할 시연에도 공통 로컬 HTTP 함수를 적용했다. API가 거절하는 1024 미만 포트와 잘못된 정규 표현을 사전 점검 inputs에서 차단하며 private 파일과 Docker 단계는 실행하지 않는다. 실제 CLI 재현은 수정 전에 PORT=80을 compose-services 오류로 안내했고, 수정 후 inputs로 안내한다. 1023·65536·앞자리 0도 첫 단계에서 거절한다.

시연 호출은 origin을 바꿀 수 없는 고정 루프백 경로와 리디렉션 거절·10초 제한을 공유하고 HTTP 실패 본문을 취소한다. 사전 health의 더 짧은 5초 제한은 유지한다. 시연의 합성 평가·관리자 승인/반려·역할 거절·자체 세션 정리는 그대로다. 현재 포트 사용 가능 여부를 새로 보장하는 기능은 아니다.

## 화면 구현 버전의 단일 출처 — v0.74

HTML의 개발 버전 표시는 고정 문자열 대신 서버의 package.json 버전을 사용한다. 서버 시작 시 숫자 세 부분의 버전 형식을 확인하고, index.html의 고정 placeholder 하나를 치환한다. 다른 정적 파일과 CSP·no-store·접근 경계는 유지한다. 개발 화면에서 제품 버전을 직접 수정할 필요가 없으며 원본 HTML만 정적으로 열면 placeholder가 보이므로 기존 API 서버를 통해 접속한다. 이 표시는 제품 버전일 뿐 커밋·이미지 digest 또는 배포 권한 증거가 아니다.

## 버전 등록 중 화면 잠금 — v0.75

세 버전 등록 폼은 같은 워크스페이스의 등록 요청 하나가 끝날 때까지 공유 잠금을 사용한다. 평가 완료·목록 새로고침의 updateButtons가 진행 중인 등록 버튼을 다시 활성화하지 않으며 추가 폼 제출도 거절한다. 서버 API의 병렬 요청·새 버전 불변성이나 권한을 바꾸지 않는 화면의 등록 직렬화다.

워크스페이스 변경은 잠금을 초기화하고 이전 요청의 성공·오류·finally는 새 워크스페이스 상태·잠금을 바꾸지 않는다. API·카탈로그·감사 읽기 이후에도 시작한 워크스페이스인지 확인한다. 자동 재전송이나 생성 기록 삭제는 추가하지 않으며 불확실한 통신 종료 후에는 버전 목록에서 결과를 확인한다. 실제 핸들러 테스트는 수정 전 평가 완료로 등록 버튼이 풀리는 경우와 로그아웃 전 요청이 새 상태를 덮는 경우를 재현했다. 수정 후 다른 폼 제출 거절과 새 등록 잠금 보존을 검증한다.
