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

`npm.cmd run benchmark:metadata -- --samples 20`은 로컬 합성 조회자 세션으로 `/v1/me`, `/v1/catalog`, `/v1/runs?limit=25`, `/v1/usage`를 순차 조회한다. 각 경로의 두 번 예열은 제외하고 1..100회(기본 20회)의 HTTP 요청과 JSON 본문 읽기 시간을 측정한다. p50/p95는 정렬된 표본의 nearest-rank 값이며 단위는 ms다. `--concurrency 1..8`(기본 1)로 한 조회자 세션의 제한된 동시 요청을 선택할 수 있다. 각 경로를 따로 측정하고 예열은 순차 수행한다. 여러 사용자·평가 처리량·운영 SLA 측정이 아니며 통과 임계값을 두지 않는다. 데이터 크기, 실행 환경과 다른 로컬 작업에 따라 결과가 달라진다.

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

## CI 발급과 프로젝트 생성의 화면 작업 — v0.76

CI 키 발급과 프로젝트 생성은 공유 작업 표시를 사용해 두 작업의 중복·겹치는 제출을 거절한다. 진행 중에는 발급·프로젝트 생성·프로젝트 선택·로그아웃 버튼을 잠그며 카탈로그/평가의 버튼 갱신도 잠금을 유지한다. 프로젝트 생성에 따른 자체 워크스페이스 초기화는 같은 작업 표시를 새 scope에 유지한다.

로그아웃·인증 만료 등으로 워크스페이스가 바뀌면 기존 작업 표시를 비운다. 이전 요청은 새 키 값을 표시하거나 현재 초안·오류 메시지·작업 잠금을 바꾸지 않는다. 새 작업의 finally는 자신의 표시가 유지된 경우에만 잠금을 해제한다. API의 키 권한·만료·철회·발급 한도와 프로젝트 멱등 처리는 그대로이며 화면 직렬화는 서버 보안을 대신하지 않는다.

실제 UI 핸들러 테스트 두 개가 수정 전에 발급 중 프로젝트 생성 가능과 이전 발급의 새 상태 덮어쓰기를 재현했다. 추가로 프로젝트 생성의 초기화 중 발급 차단, 이전 프로젝트 생성 후 새 발급 잠금·새 프로젝트 초안 보존을 검증한다. 테스트 키는 합성 문자열이며 사용자 환경의 새 접근 권한을 발급하지 않는다.

## 키보드 이동과 현재 패널 탐색 — v0.77

본문 바로 이동 링크와 main focus 대상을 추가하고 링크·버튼·입력의 키보드 focus-visible 윤곽선을 제공한다. 탐색 링크는 현재 URL hash에 따라 강조와 aria-current=location을 갱신하며 브라우저 뒤로/앞으로 이동도 hashchange로 반영한다. 메뉴에 없는 근거·최종 게이트 패널에서는 첫 메뉴를 잘못 강조하지 않는다.

워크스페이스가 준비되기 전과 로그아웃 화면에서는 패널 메뉴를 숨긴다. 프로젝트 관리 링크는 관리자에게만 표시하며 서버의 프로젝트 권한을 바꾸지 않는다. 이는 제한된 키보드·탐색 개선이며 접근성 표준 전체 적합성 검증을 주장하지 않는다. 기존 화면 핸들러 검증을 유지하고 실제 브라우저에서 패널 이동·뒤로 이동·본문 focus를 확인한다.

## 좁은 화면의 패널 탐색 — v0.78

650px 이하 화면에서도 준비된 워크스페이스의 탐색 링크를 가로 스크롤 메뉴로 제공한다. 이전 CSS는 이 크기에서 메뉴를 모두 숨겨 패널 이동에 긴 페이지 스크롤이 필요했다. 링크는 최소 높이 44px이며 현재 위치 강조·키보드 focus·권한별 메뉴·로그아웃 숨김은 유지한다. 메뉴 내부만 가로 스크롤하고 전체 페이지의 가로 넘침을 만들지 않는다. 큰 화면의 세로 탐색 레이아웃은 유지한다. 390px 및 기존 화면의 실제 브라우저로 확인하며 전체 모바일·보조기술 적합성을 보장하지 않는다.

## 실행 목록의 페이지 선택 후 메타데이터 계산 — v0.79

실행 목록은 조직·프로젝트·cursor·상태·판정 필터와 created_at/id 순서로 내부 페이지를 먼저 선택한다. 그 제한된 행에서만 gate/summary·스냅샷 이름·정밀 cursor 시간을 계산한다. 외부 조회에도 같은 순서를 명시해 순서를 보존한다. 기본 최대 100개 또는 요청 페이지+cursor 판정용 한 행, 반환 구조·필터·조직 RLS는 유지한다. DB 스키마와 근거·게이트 판정은 변경하지 않는다.

같은 로컬 조직/프로젝트의 729개 행에서 25개 페이지와 cursor를 조회했다. 읽기 전용 직접 SQL의 20개 표본과 두 번 예열에서 p50은 38.279→3.394ms, p95는 51.002→4.979ms였다. 별도 EXPLAIN ANALYZE는 실행 45.935→1.562ms, shared hit blocks 4576→292였으며 전체 페이지 해시는 같았다. 이전 계획은 모든 729개 행의 JSON 값을 계산하고 정렬했으며 새 계획은 Limit 뒤 26개 행의 메타데이터를 계산했다. 기본 필터 없이 수행한 로컬 표본으로 운영 SLA·동시 부하 또는 필터 검색 전체 성능을 보장하지 않는다. 판정 필터는 여전히 후보 행의 outcome을 읽어야 한다.

기존 실제 API 검증은 페이지 중복 없음·cursor scope·상태/판정 필터·대기 결과의 차단·unpaged 호환성과 근거/전체 결과 미노출을 확인한다. private SQL 계획·측정 보고서는 .local에 보존하고 접근 키·연결 문자열을 출력하지 않는다.

같은 로컬 데이터의 실제 HTTP 측정에서도 `/v1/runs?limit=25` p50/p95는 47.410/56.429→11.448/13.912ms였다. 경로별 두 예열과 20개 순차 표본이며 전후 조회자 세션을 로그아웃했다. SQL 대조는 API/HTTP/인증과 트랜잭션의 다른 문장을 제외하므로 두 종류의 시간을 합치지 않는다.

## 초기 로딩 뒤 패널 위치 복원 — v0.80

워크스페이스 초기 로딩은 패널을 숨긴다. 이때 브라우저가 URL fragment의 숨겨진 대상에 스크롤하지 못하므로 #history 주소에서 새로고침하면 실행 기록 메뉴가 강조되어도 페이지 위가 표시됐다. 초기화를 마치고 실제로 표시되는 대상이 있을 때 현재 fragment 위치로 scrollIntoView한다. 없는 대상과 역할/선택 때문에 숨긴 대상은 이동하지 않으며 게이트나 실행을 자동 조회·승인하지 않는다. 브라우저 focus를 별도로 바꾸지 않고 기존 native 링크·뒤로/앞으로 이동은 유지한다.

실제 브라우저의 #history 새로고침에서 수정 전 scrollY=0, historyTop=2012px를 관측했다. 같은 메뉴를 직접 클릭하면 historyTop=0이었다. 변경 후 새로고침/초기화 완료 뒤의 실제 위치를 확인한다. 이 변경은 URL fragment의 패널 탐색이며 저장된 실행을 자동 선택하는 기능이 아니다.

## 제한된 병렬 합성 생성 점검 — v0.81

npm run smoke:burst는 기본 12개, --runs 2..20 범위의 합성 평가를 최대 네 개 진행한다. 같은 멱등 키의 네 요청이 하나의 실행으로 수렴하는지 확인한 뒤 각 실행의 완료를 기다리며 다음 요청을 제출한다. 활성 실행 10개 제한을 우회하지 않으며 실패한 생성은 자동 재시도하지 않는다. 이미 실행 중인 다른 작업으로 한도가 찼다면 점검은 중단될 수 있다.

여섯 모의 판정의 상태·버전 연결·배포 허용 값을 확인하고 pass/block 서명을 검증한다. 자신의 실행 ID에 한정해 사용량·사례·시도 수와 run.queued 및 terminal 감사가 한 번씩 기록되는지 확인한다. 진행 중 요청이 모두 정리된 뒤 자신의 알려진 실행만 취소하며 세션을 로그아웃한다. 생성 응답이 불확실하면 private 보고서에 creationOutcomeUnknown을 기록하고 성공으로 처리하지 않는다.

실제 로컬 12개 점검이 통과했다. 네 회귀 테스트는 입력 범위, 제한된 진행·중복 수렴, 부분 생성 실패의 정리 순서, 판정·서명·회계 불일치의 차단을 확인한다. CI는 여섯 개를 실행한다. 합성 기록은 보존되며 이는 병렬 워커 처리량·운영 부하 한도나 SLA 측정이 아니다. .local 보고서와 접근 키·DB 연결 정보는 커밋하지 않는다.

## 장시간 점검의 오류 응답 정리 — v0.82

로그인 응답 본문을 읽은 뒤 쿠키를 저장하던 순서를 변경했다. 세션 쿠키를 본문 처리 전에 보관하므로 잘못된 JSON이나 HTTP 오류가 와도 finally에서 로그아웃한다. 응답 JSON에는 릴리스 CLI와 같은 크기·UTF-8 검증을 적용하며 503 재시도와 다른 HTTP 오류의 응답 본문은 취소한다. 모의 서버로 실제 sustained 명령을 실행한 회귀 테스트는 변경 전 실패를 재현하고 변경 후 손상된 JSON·HTTP 500에서 세션 정리, 실패 종료, 비밀 미노출을 확인한다. 기존 재시도 한도와 합성 판정은 유지한다.

## 검증 기준선과 설치 시연 안내 정리 — v0.83

README와 기술 설명의 고정 근거를 실제 네 CI 작업·온라인 전달 검증이 끝난 v0.82 커밋 1022064024afca6ea5e6074093dbac6bb856e34f, 실행 37202990662, 269개 테스트로 갱신했다. 기존 설치의 npm ci/setup 재실행에서 설정·접근 키·서명 키 네 파일 보존과 5/10/11단계 시연을 기록했다. 로컬 새 볼륨 설치, 고객 모델·상용 서버 배포와 구분한다. 다음 구현 문서의 과거 v0.41 상태와 원격 CI 미완료 설명도 현재 검증 범위로 정리했다. 과거 화면과 버전별 구현 이력은 유지한다.

## 로그인 범위별 세션 종료 잠금 — v0.84

세션 종료 응답을 기다리는 중 로그아웃·재로그인하면 이전 sessionBusy가 새 목록에서도 남아 다음 세션 종료를 막았다. 프로젝트/로그인 범위를 정리할 때 잠금을 초기화하고, 이전 요청의 finally는 같은 scopeEpoch일 때만 잠금 해제·목록 재조회를 수행하도록 했다. 정리 중 추가 조회의 오류도 같은 범위에만 표시한다.

실제 UI 핸들러의 지연 응답 테스트로 변경 전 새 종료가 시작되지 않는 실패를 재현했다. 변경 후 새 종료가 진행되고 이전 완료가 그 잠금을 해제하거나 상태 메시지를 덮지 않는지 확인한다. 이전 현재 세션 종료 응답이 재로그인한 화면을 로그아웃시키지 않는 기존 API 범위 보호도 유지한다. 이는 UI 요청 수명 제어이며 서버 세션 철회·권한 검증은 변경하지 않는다.

CI 키 철회의 늦은 응답도 새 로그인 화면의 상태 문구를 덮는 것을 별도 재현했다. 같은 범위에서만 목록 갱신·완료·실패 문구와 버튼 상태를 변경한다. 서버의 철회 결과를 되돌리지 않으며 새 키나 권한을 발급하지 않는다. 세 가지 회귀 테스트와 기존 UI 범위 테스트를 함께 실행한다.

## 기존 점검 명령의 로그인 실패 정리 — v0.85

재시작·CI·관리자 검토·복구 smoke의 로그인을 각 정리용 try/finally 안으로 옮겼다. 세션이 발급됐지만 응답이 손상되거나 HTTP 오류가 발생해도 자신의 쿠키가 있으면 로그아웃한다. HTTP 오류 본문은 닫고 JSON에는 공통 크기·UTF-8 검증을 적용한다. main의 최종 오류 출력은 고정 문구이며 응답 원문·스택·비밀을 출력하지 않는다. 잘못된 PORT는 파일 읽기·로그인 전에 기존 고정 안내와 실패 종료를 유지한다.

모의 루프백 서버로 네 실제 CLI를 실행한 테스트에서 변경 전 모두 로그아웃 0회로 실패했다. 변경 후 각각 손상 JSON과 HTTP 500에서 로그아웃 1회·실패 종료·본문/키/세션 canary 미노출을 확인한다. 복구 CLI는 로그인 단계에서 중단하므로 이 테스트는 Docker 서비스에 영향을 주지 않는다. 기존 성공 평가·서명·복구 검증은 CI와 실제 점검을 따른다. 통신 중단으로 발급 결과가 보이지 않으면 서버 기록을 모두 발견한다는 보장은 없다.

## 실행 전환 중 이전 실행의 동작 차단 — v0.86

새 실행을 선택한 뒤 GET 응답을 기다리는 동안 currentRun은 이전 화면의 실행을 가리킬 수 있었다. 검토 제출과 취소 핸들러가 응답 뒤에만 선택을 검증하므로 이전 실행에 쓰기 요청이 이미 나갈 수 있었다. 두 실제 UI 지연 응답 테스트에서 이전 실행 검토/취소가 각각 한 번 요청되는 변경 전 실패를 재현했다.

선택 시작 시 기존 검토 패널을 숨기고 검토·취소·결과 저장 버튼을 비활성화한다. 이전 검토 조회의 sequence를 무효화하고, 검토 제출·취소·저장 핸들러는 currentRun.id와 selectedRunId가 같은지 먼저 검사한다. 검토 조회도 다른 선택의 패널을 다시 표시하지 않는다. 새 실행이 도착하면 기존 상태·역할·완료 조건에 따라 동작이 복구된다. 화면에 남은 이전 스냅샷은 실행 ID를 유지하며 선택이 끝나기 전에 그 실행을 변경하는 요청을 보내지 않는다. 서버 권한과 최종 게이트 계약은 유지한다.

## 선택한 실행의 핵심 단계 탐색 — v0.87

워크스페이스 메뉴에 평가 근거·릴리스 검토·최종 게이트 링크를 추가했다. 현재 선택한 실행의 응답이 도착하면 근거/게이트 링크를 표시하고, 검토가 필요한 정책의 검토 패널을 준비한 뒤 검토 링크를 표시한다. 선택 없음·다른 실행 로딩·프로젝트 전환·로그아웃 때는 이전 실행 링크를 숨긴다. 현재 fragment와 aria-current, native 링크·키보드·좁은 화면 가로 탐색은 기존 동작을 사용한다.

조회자는 읽을 수 있는 검토 이력으로 이동하지만 검토 폼과 관리자 버튼은 활성화하지 않는다. 링크 클릭은 평가·승인·게이트 요청을 자동 실행하지 않는다. 두 UI 테스트는 링크의 선택 수명과 조회자의 읽기/쓰기 구분을 확인한다. URL은 패널 위치이며 실행 ID를 저장하거나 새로고침 후 실행을 자동 조회하는 링크가 아니다.

## 낮은 화면의 탐색 메뉴 스크롤 — v0.88

실제 1280×500 브라우저에서 여덟 메뉴의 마지막 링크 하단이 578px였고 nav overflow-y는 visible이었다. 고정 높이 sidebar 아래로 벗어난 메뉴에 접근하기 어려웠다. 메뉴에 min-height 0과 세로 스크롤을 적용해 flex 공간 안에서 줄어들도록 하고 여백과 가로 넘침을 제한했다. 모바일은 기존 가로 스크롤을 유지하며 세로 넘침을 숨긴다. 탐색·선택·권한과 게이트 요청은 바꾸지 않는다.

v0.83 서버의 두 번째 30주기·270개 합성 점검은 오류 재시도 없이 완료하고 자신의 사용량·감사 정확성과 세션 로그아웃을 확인했다. 기존 서버의 976개 실행을 40페이지로 끝까지 읽어 DB의 해당 프로젝트 cutoff 순서와 정확히 대조했고 중복 ID·전체 근거 미노출을 확인했다. 새 로그인 감사는 생성하지만 실행/검토 기록은 변경하지 않았다. 새 백업으로 격리 DB 복원·데이터 지문·보안 카탈로그·RLS·앱 연결 차단·변조 거절·실패 평문 제거를 다시 확인했다. 반복 점검 자체는 v0.83 서버에서 수행됐으며 새 화면·백업은 v0.87에서 확인했다. 이는 새 설치나 운영 부하·상용 배포 검증이 아니다.

실제 수정 후 1280×500에서 메뉴 높이 216px/내용 444px, scrollTop 228px로 마지막 로그인 세션 링크를 열었다. 링크 하단 353px로 화면 안에 들어왔으며 overflow-y는 auto였다. 390×844에서도 전체 페이지 폭이 화면 폭을 넘지 않고 가로 메뉴·최종 게이트 hash 이동과 aria-current를 유지했다. 임시 viewport를 원래 크기로 복원했다.

## 승인 응답이 불확실한 합성 점검 정리 — v0.89

관리자 검토 smoke는 승인 응답을 정상으로 읽은 뒤 approved 플래그를 켰다. 서버가 승인을 처리한 뒤 응답이 손상되거나 중간 HTTP 오류가 나면 finally가 반려를 생략할 수 있었다. 실제 자식 명령과 모의 서버에서 승인 적용 뒤 손상 JSON을 보내 변경 전 approved만 기록되고 정리 반려가 없는 실패를 재현했다.

승인 요청을 보내기 전에 approvalAttempted를 기록한다. 자신의 알려진 합성 실행에 승인을 시도했고 정상 반려를 확인하지 못했다면 finally에서 반려를 시도하고 자신의 로그인 세션을 종료한다. 손상 JSON과 HTTP 500 각각에서 approved→rejected, 실패 종료, 로그아웃과 canary 미노출을 검증한다. 성공 시연도 원래 반려로 끝난다. 통신 중단·권한 소멸 등으로 정리 반려가 실패하면 명령은 실패이며 최종 상태를 모두 알아냈다고 주장하지 않는다. 실제 사용자 검토나 다른 실행에 반려를 쓰지 않는다.

## 이전 프로젝트 초기화의 되돌리기 범위 — v0.90

프로젝트 초기화 중 로그아웃·재로그인하면 API는 이전 응답을 무효화하지만 프로젝트 change의 catch는 새 actor가 있다는 이유로 이전 프로젝트에 되돌리기를 시도했다. 새 로그인에서 해당 프로젝트가 거절되면 새 화면까지 로그인 화면으로 돌릴 수 있었다. 이전 finally도 새 프로젝트 초기화의 선택 잠금을 해제했다. 실제 UI 핸들러의 지연 응답 테스트에서 두 변경 전 실패를 재현했다.

프로젝트 전환은 자신의 scopeEpoch에서만 완료 문구·되돌리기·선택 잠금 해제를 수행한다. 자신의 실패로 되돌리기를 시작할 때는 새 epoch를 소유하고 그 동안 다시 로그인/전환이 일어나면 같은 보호를 적용한다. 서버의 조직·프로젝트 권한은 유지한다. 테스트는 새 로그인 화면/선택/문구 보존과 새 전환 잠금 및 완료를 확인한다.

## 선택할 때 표시하는 최종 게이트 비교 입력 — v0.91

기본 비교 제외 상태에서도 기준 실행 선택·UUID와 안내가 모두 표시되어 최종 판단이 화면 아래로 밀렸다. 기준 입력 묶음은 기본적으로 숨기고 기존 회귀 비교 체크박스를 선택하면 표시한다. 입력 값과 후보 제외·호환성 검사·게이트 요청 계약은 유지하며 비교 제외 시 기존처럼 baselineRunId를 요청에 넣지 않는다. 토글은 현재 검증 기록을 무효화하고 재확인을 요구한다.

기존 옵션 비교 테스트에 표시 상태와 토글/로그아웃 정리를 함께 확인했다. 별도 새 권한·자동 조회·게이트 실행은 추가하지 않는다. 실제 화면에서 기본 최종 판정과 선택 시 기준 입력 접근을 확인한다.

실제 v0.91 기본 패널은 720px 화면에서 약 470px 높이였고 새 반려 판정의 전체 문구가 같은 화면에 표시됐다. 비교 입력의 표시/숨김과 이전 JSON 저장 비활성화를 확인했다. 조회자 브라우저에서 합성 관리자 반려 사례를 새로 검증한 화면은 docs/evidence/current-rejection-v091.png에 저장했다. 이미지에서 접근 키·연결 정보·private key·고객 데이터가 없음을 확인했다. 이 화면은 촬영 당시 합성 기록이며 현재 배포 권한의 증명은 아니다.

## 검증된 CI 이미지의 기존 설치 전환 점검 — v0.92

v0.91 revision과 CI 네 작업 성공을 독립적으로 지정해 온라인 검증했다. 실제 artifact ZIP SHA-256은 GitHub metadata와 일치했고 manifest checksum은 승격 로그와 일치했다. 같은 GHCR digest를 기존 agenttrust API·워커에만 적용해 실제 이미지 identity/isolation, 전환 전후 합성 실행·사용량·감사 기록과 서명된 승인/반려 시연을 검증했다. finally에서 소스 빌드로 복원하고 준비 점검을 통과했다. 점검은 같은 스키마의 기존 로컬 설치이며 외부 배포·이전 스키마 롤백·무중단·SLA 증거는 아니다. 비밀과 상세 보고서는 private .local에 보관한다.

## 이전 워크스페이스 조회 동작의 오류·버튼 보호 — v0.93

데이터셋 초안 복사·운영 상태 갱신·과거 게이트 기록 JSON 조회의 늦은 오류가 새 로그인/프로젝트 화면의 상태를 덮어쓸 수 있었다. 운영 갱신의 이전 finally는 새 요청의 버튼 잠금도 해제했다. 실제 UI 핸들러와 지연 모의 응답에서 세 실패를 재현했다.

각 동작은 자신의 scopeEpoch에서만 결과·오류·버튼 상태를 갱신한다. 프로젝트 정리는 운영 갱신 버튼을 재설정하고 이전 요청은 새 잠금을 해제하지 않는다. 반복 클릭을 막으며 현재 범위의 초안 복사·운영 갱신·JSON 저장이 계속 동작하는지도 테스트한다. 조직·프로젝트 권한과 과거 서명 기록의 의미는 바꾸지 않는다.

## 시연·측정 명령의 응답 경계 — v0.94

portfolio-demo·portfolio-roles·metadata-benchmark의 기본 response.json은 잘못된 UTF-8을 대체 문자로 받아들이고 응답 바이트 제한이 없었다. 실제 자식 명령과 모의 HTTP 서버에서 손상 UTF-8 로그인 뒤 다음 조회가 진행되는 세 실패를 재현했다. 기존 readReleaseResponse의 8 MiB 제한과 엄격한 UTF-8/JSON 읽기를 적용하고 demo-preflight의 health 응답도 같은 경계를 사용한다.

세 명령 각각에서 손상 UTF-8과 한도를 넘는 유효 JSON을 차단하고 시연 조회가 시작되지 않으며 발급된 자체 세션을 로그아웃하고 비밀 canary를 노출하지 않는지 확인한다. 기존 loopback·리디렉션 거절·HTTP deadline·고정된 실패 출력은 유지한다. 응답 제한은 서버 전체 자원 제한이나 운영 부하 검증을 대신하지 않는다.

## 브라우저 응답 읽기의 크기·문자열·오류 경계 — v0.95

실제 UI 핸들러를 네이티브 Response/ReadableStream 모의 응답으로 실행해 잘못된 UTF-8이 대체 문자로 읽혀 최종 통과를 표시하고 손상 JSON 파서 오류가 합성 원문 canary를 표시하는 변경 전 실패를 재현했다. 8 MiB 스트림 한도와 엄격한 UTF-8/JSON 읽기를 적용한다. 초과 시 읽기를 취소하고 reader lock을 정리한다. 전송·파서 원문 오류 대신 고정된 재조회 안내를 사용하고 기존 15초 deadline와 이전 scope 결과 거절은 유지한다. 서버 HTTP 오류의 문자열 메시지만 제한된 길이로 표시한다.

손상 JSON·UTF-8·한도 초과는 실패로 표시하고 현재 기록 저장을 활성화하지 않는다. 버튼 잠금 정리와 정상 재확인·서명 기록 저장도 검증했다. 기존 초기 hydration/로그인 실패 테스트는 원문 오류 노출 대신 고정 안내와 화면 복구를 확인한다. 위협 모델에서 현재 구현과 OIDC·비밀 저장소·서명된 이미지 출처 인증 등 미구현 운영 목표를 구분하고, 최대 100개 사례·2,000개 규칙의 실제 합성 API/브라우저 점검을 기록한다.

## 최종 게이트의 선택 실행·기준 근거 연결 — v0.96

다른 실행이나 기준의 artifact는 JSON 저장을 막았지만 표시 전 연결 검사가 없어 선택한 실행의 통과 문구를 표시할 수 있었다. 기존 두 UI 테스트를 확장해 변경 전 잘못된 통과 표시를 재현했다. 결과를 표시하기 전에 응답 runId·artifact request 후보·candidate evidence와 선택한 실행, 요청한 기준 유무·ID와 baseline evidence를 검사한다. 누락·불일치는 확인 실패이며 기록 저장을 활성화하지 않는다.

다른 실행 전체 응답, 결과 ID만 불일치, artifact 후보/근거만 불일치, artifact 누락과 다른 기준을 확인하고 정상 재확인·원본 서명 JSON 저장이 계속 동작함을 검증했다. UI의 구조·연결 검사는 암호학적 서명 검증이 아니다. CI/오프라인 명령의 독립 신뢰 공개키 검증을 유지한다. 고정 문서 기준선은 검증된 v0.95 CI의 291개 테스트로 갱신한다.

실제 로컬 v0.96에서 준비 점검과 핵심 10단계·역할 11단계 시연이 통과했다. 조회자 브라우저의 네이티브 응답 읽기 경로에서 정상 게이트 통과와 관리자 반려 후 차단, 현재 기록 저장 버튼 활성화와 승인 폼 숨김을 확인했다. 브라우저 파일 다운로드 완료는 주장하지 않으며 서명 파일 검증은 독립 CLI 시연으로 확인했다. v0.94 두 장시간 점검까지 포함한 네 완료 보고서의 실행 ID 1,080개가 서로 다름을 대조했고 원본은 private .local에 보관한다.

## 화면 판정과 검증 기록 원문의 일치 — v0.97

화면의 최종 게이트는 선택 실행에 연결된 응답이라도 바깥 판정·승인·비교와 artifact.result가 다른 경우를 검출하지 않았다. 실제 UI 핸들러의 변경 전 테스트에서 기록 원문은 block인데 화면은 pass로 표시되는 결함을 재현했다. 표시 전에 전체 결과를 기록의 result와 키 순서에 독립적으로 대조한다. 누락·불일치는 확인 실패이며 현재 기록 저장을 활성화하지 않는다.

비재귀 비교는 깊이 64·방문 100,000개로 제한한다. 지원 범위인 2,000개 규칙 회귀의 표시와 정상 재확인, 원본 서명 JSON 저장 및 독립 공개키 검증을 확인한다. 이 구조 검사는 암호학적 서명 검증이나 실제 배포 직전의 새 CI 검증을 대신하지 않는다.

## 초기화 대상의 로컬 설정 검증 — v0.98

설치 명령은 Docker와 마이그레이션 전에 생성 설정의 여섯 DB URL을 검사한다. API·워커·소유자 역할과 해당 hex 비밀번호, 127.0.0.1과 DB_PORT, agenttrust와 별도 agenttrust_test 이름을 확인한다. 원격 호스트·다른 DB·역할/비밀번호/포트 불일치·query/fragment와 API/DB 포트 충돌은 고정 안내로 거절한다. 설정 원문과 비밀은 출력하지 않는다. 이 명령은 로컬 초기화 전용이며 상용 DB 이전 명령이 아니다.

실제 자식 명령에서 잘못된 테스트 DB 설정이 변경 전 Docker 호출까지 진행하는 결함을 재현했다. 수정 후 Docker·DDL 전에 거절하고 기존 설정을 보존한다. 사용자 지정 로컬 포트와 기존 저널 복구 테스트, 실제 기존 설치의 setup 재실행을 통과했으며 .env·접근 키·서명 키 지문이 모두 유지됐다. 포트 사용 가능 여부 검사는 별도이며 자동으로 다른 포트를 선택하지 않는다.

## 단일 신뢰 공개키와 파일 읽기 한도 — v0.99

서명 검증은 PUBLIC KEY 시작만 확인하던 입력을 단일 공개 SPKI PEM 전체로 제한한다. 공개키 뒤의 두 번째 키·private key·원문과 1 KiB 초과 파일을 거절하고 Ed25519 타입 검사를 유지한다. CI 릴리스 CLI는 신뢰키 파일을 제한된 버퍼와 엄격한 UTF-8로 읽고 인증 요청 전에 검증한다. 오프라인 CLI도 같은 reader를 사용해 키를 먼저 검증한다.

변경 전 단일 키 뒤에 다른 PEM이 붙어 있어도 통과한 두 실패를 실제 자식 CLI와 공유 검증에서 재현했다. 수정 후 원문·비밀 노출 없이 거절하고 네트워크 요청이 없음을 확인한다. 정확한 바이트 한도, 손상 UTF-8, 빈/없는 파일·디렉터리, CRLF와 정상 서명·대형 기록 검증을 유지한다. 키를 자동 선택하거나 private key에서 신뢰 공개키를 추출하지 않는다.

## 취소 대기 잠금과 완료 경합의 실제 상태 — v0.100

주기 조회가 진행 중인 실행을 다시 표시하면서 취소 버튼을 해제해 중복 요청이 가능했고, 워커 완료가 취소보다 먼저 확정돼도 화면은 취소 성공을 안내했다. 실제 UI 핸들러의 변경 전 두 실패를 재현했다. 취소 잠금을 워크스페이스·선택 세대·실행에 연결하고 render와 제출에서 확인한다. 서버가 반환한 최종 상태가 cancelled일 때만 취소 성공을 안내하며 다른 종료 상태는 이미 종료됐다고 실제 상태를 보여준다.

주기 조회·중복 클릭, 성공/오류/시간 초과가 먼저 완료되는 세 경합, 요청 실패 후 명시적 재시도와 이전 취소가 새 선택의 취소 잠금을 해제하지 않는지 확인한다. 서버의 최종 확정 fencing과 정확히 한 번 사용량·감사는 변경하지 않는다. 네트워크 실패는 서버에서 처리됐을 수 있다는 기존 재조회 안내를 유지하며 자동 재전송하지 않는다.

## 목록 조회 실패의 요청 소유권 — v0.101

실행·감사·CI 키·게이트 기록·세션 목록의 지연 실패가 새 로그인과 최신 새로고침의 상태 안내를 덮어쓸 수 있었다. 목록 요청의 scopeEpoch와 목록별 조회 세대를 함께 보관해 자신의 오류와 페이지 버튼 복구만 반영한다. 검토 목록은 실행 선택 세대도 확인한다. 변경 전 두 UI 테스트에서 오래된 실패가 최신 상태를 덮는 동작을 재현했다.

다섯 목록의 워크스페이스 변경과 같은 범위의 최신 새로고침, 세 페이지 목록에서 이전 실패가 새 페이지 요청 잠금을 해제하지 않는지 확인한다. 현재 실패의 안내와 명시적 새로고침 복구는 유지한다. API 권한·cursor·불변 기록과 요청 실패의 자동 재전송 금지는 변경하지 않는다. 고정 문서 근거는 v0.100 CI의 301개 테스트로 갱신한다.

## 최종 기록의 고정 버전·범위·조회 근거 연결 — v0.102

최종 게이트 기록이 실행 ID와 판정에는 연결돼도 요청 버전·조직·프로젝트·후보 근거 해시가 다른 경우를 화면에서 검사하지 않았다. 변경 전 테스트에서 누락·다른 버전·다른 범위와 다른 스냅샷/결과 해시의 기록을 통과로 표시하는 결함을 재현했다. 전송한 요청 전체와 artifact.request를 대조하고, 현재 범위와 artifact 조직/프로젝트, 조회한 실행과 후보 근거의 snapshotHash/resultHash를 확인한다.

잘못된 version 기대값과 불필요하게 긴 maxAgeSeconds 삽입, 누락·다른 조직/프로젝트와 후보 근거 해시를 확인 실패로 처리한다. 정상 재확인·기준 비교·서명 원본 저장을 유지한다. UI 연결 검사는 독립 신뢰 공개키 검증을 대신하지 않는다. 비교 기준 실행의 전체 원문은 UI에서 추가 조회하지 않으며 기준 ID 연결과 서버/CLI 무결성 검증을 유지한다.

## 복구 작업의 로컬 설정 경계 — v0.103

백업·검증 복원·복구 smoke는 파일 처리와 DB pool 생성 전에 setup과 동일한 로컬 설정 검사를 적용한다. 생성된 여섯 URL의 loopback 주소·역할/비밀번호·포트·운영/테스트 DB 이름을 확인해 원격 또는 불일치 대상에 연결하지 않는다. 복구 명령은 생성 설정을 사용하는 로컬 AgentTrust 전용이다.

변경 전 실제 백업 자식 명령에서 다른 호스트 설정으로 pool을 생성하는 경로를 재현했다. PG 경계를 모의해 실제 외부 연결 없이 확인했으며, 수정 후 백업·복구 smoke의 pool 생성과 없는 백업 파일 읽기 전에 설정을 거절한다. 기존 암호문 인증·격리 DB·복원 보존 절차는 유지한다. 실패 출력에는 설정 주소·비밀번호와 원문 오류를 포함하지 않는다.

## 제한된 동시 메타데이터 조회 측정 — v0.104

`npm.cmd run benchmark:metadata -- --samples 20 --concurrency 8`은 한 로컬 합성 조회자 세션에서 네 고정 조회 경로를 최대 여덟 요청씩 측정한다. 기본 순차 실행을 유지하며 표본은 경로마다 1..100개다. 보고서는 concurrency, maximumInFlightRequests, timingMode와 oneViewerSession을 기록하고 실제 요청·엄격한 JSON 본문 읽기 시간을 측정한다. 여러 사용자 부하·평가 처리량·상용 SLA의 근거로 사용하지 않는다.

동시 요청은 제한된 wave 단위로 모두 종료된 후 다음 wave를 시작한다. 하나가 실패하면 이미 시작한 요청을 모두 기다린 뒤 차단하고 세션을 로그아웃하며 추가 wave·다음 경로·자동 재시도를 실행하지 않는다. 실제 자식 명령의 합성 서버에서 동시 요청 상한, 빠른 실패와 늦은 응답의 정리 순서, 비밀 미출력과 잘못된 동시성 옵션의 인증 전 거절을 검증한다.

## 인증 화면의 지연 응답과 요청 소유권 — v0.105

초기 화면 읽기 또는 이전 로그인 초기화의 늦은 실패가 새로 로그인한 워크스페이스를 닫고 새 로그인 버튼 잠금을 해제하는 세 실패를 실제 UI 핸들러에서 재현했다. 인증 세대와 scopeEpoch로 초기화·로그인의 오류 안내와 버튼 복구를 소유 요청에 연결한다. 현재 요청의 401에만 API가 표시한 새 인증 경계를 전달해 정상 접근 키 오류와 초기화 중 세션 만료의 로그인 복구를 유지한다.

로그인·로그아웃 중복 요청을 막으며 오래된 로그아웃 오류가 새 범위 상태를 덮지 않게 한다. 기존 워크스페이스 변경 잠금과 현재 실패 후 명시적 재시도는 유지한다. 이 보호는 화면 상태 소유권에 관한 것이며 서버 세션·쿠키 계약과 권한 검사는 변경하지 않는다. 인증 요청을 자동 재전송하지 않는다.

## 시연·배포 준비 검사의 신뢰 공개키 일치 — v0.106

시연 준비 검사는 public.pem에 개인키가 있어도 공개 부분을 자동 추출해 통과했다. 실제 자식 CLI의 합성 키·모의 Docker 읽기·루프백 health 서버에서 잘못된 개인키 파일이 전체 준비 검사를 통과하는 실패를 재현했다. 시연·배포 preflight는 릴리스 CLI와 같은 1 KiB·엄격한 UTF-8·단일 공개 SPKI PEM reader를 사용해 그 입력을 거절한다.

개인키 원문, 공개키 뒤 다른 개인키/공개키, 초과 파일과 손상 UTF-8은 시연의 Docker·health 단계 전에 차단한다. 정상 CRLF 공개키와 기존 로컬 키 쌍의 실제 준비 검사는 통과한다. 개인키를 다시 생성하거나 기존 파일을 덮어쓰지 않으며 서명 타입·짝 검사를 유지한다.

## 발급 키 복사의 현재 요청 소유권 — v0.107

비어 있거나 숨긴 키의 복사 요청과 이전 워크스페이스 복사 완료가 성공 안내를 표시하는 세 실패를 실제 UI 핸들러와 합성 클립보드에서 재현했다. 복사 요청을 로그인 범위·발급 키 세대·작업 소유권에 연결하고 중복 복사를 막는다. 키 닫기·새 발급 시작·워크스페이스 초기화는 입력 원문과 복사 상태를 지우며 이전 완료가 새 안내·버튼 잠금을 변경하지 못한다.

현재 클립보드 거절은 안전한 오류를 표시하고 사용자의 명시적 재시도를 허용한다. 시작한 OS 복사를 소급 취소하거나 OS 클립보드 원문을 자동 삭제하는 기능은 아니다. 실제 접근 키를 테스트 클립보드에 쓰지 않으며 키·쿠키를 로그·보고서·Git에 기록하지 않는다.

## 화면 초기화 전체의 원래 범위 유지 — v0.108

API 읽기 자체가 성공한 직후 다른 요청의 401이 로그인 범위를 변경하면 이전 초기화가 새 범위에서 후속 조회를 시작할 수 있었다. 실제 UI 핸들러의 응답 스트림 완료와 microtask 순서를 제어해 변경 전 세션 만료 뒤 catalog 조회가 실행되는 실패를 재현했다.

initialize는 원래 scopeEpoch를 보관하고 각 비동기 단계 직후 확인한다. identity·샘플 데이터의 DOM 반영 전에 확인하며 이후 목록·catalog·샘플·감사 요청과 완성 화면 표시를 중단한다. 로그인 인증 응답 직후에도 자신의 인증 세대·범위를 확인해 이전 성공이 새 입력을 지우거나 초기화를 시작하지 못한다. 정상 초기화·현재 401의 로그인 복구와 프로젝트 전환을 유지한다. 범위가 바뀐 요청을 재전송하지 않는다.

## 과거 검증 기록 저장의 목록·범위 연결 — v0.109

과거 기록 저장 버튼은 목록에서 선택한 기록과 다른 응답도 그대로 파일로 만들었다. 변경 전 다른 receiptId 응답이 Blob으로 저장되는 실패를 실제 UI 핸들러에서 재현했다. 기록 ID·확인 시각·목록 artifactHash·후보/기준 ID·판정/허용 여부·서명 키/형식과 현재 조직·프로젝트를 확인한 뒤 원본을 저장한다. 불일치는 파일을 만들지 않고 안전한 오류와 명시적 재시도를 제공한다.

정상 통과·차단과 선택적 기준 비교의 artifact·해시·서명을 유지하며, 기존 비서명 기록도 그대로 저장한다. 세션 전환 후 오래된 다운로드 오류는 새 안내를 변경하지 않는다. 목록과 응답의 결합 검사는 내용 해시 재계산이나 독립 키의 암호학적 서명 검증을 대신하지 않는다. 서명 출처는 별도 receipt:verify로 확인하고 과거 PASS를 현재 배포 허용으로 재사용하지 않는다.


## 세션 종료 완료의 원래 프로젝트 범위 유지 — v0.110

세션 종료의 성공 응답을 읽은 뒤 UI 처리 전에 프로젝트를 전환하면 이전 완료가 로그인 화면을 표시하거나 새 프로젝트의 안내·후속 목록 조회를 변경할 수 있었다. 응답 스트림과 microtask 순서를 제어한 실제 UI 핸들러 테스트에서 변경 전 실패를 재현했다. 완료 직후와 세션 목록 조회 후 원래 scopeEpoch를 확인해 이전 요청의 화면 반영과 후속 감사 조회를 중단한다.

현재 세션·다른 세션의 정상 종료, 중복 종료 방지, 지연 응답과 새 작업 공간의 잠금 보호를 유지한다. 이미 서버에서 완료한 세션 철회를 되돌리거나 새 로그인 세션을 철회하지 않는다. 합성 세션만 사용하며 실제 사용자 세션·접근 키를 변경하지 않는다.


## 버전 목록 갱신 완료의 원래 프로젝트 범위 유지 — v0.111

새 버전 등록 후 catalog 성공 응답을 읽은 직후 프로젝트 전환이 시작되면 이전 목록의 에이전트·데이터셋·정책 선택지가 새 범위의 초기화 화면에 다시 표시될 수 있었다. 응답 스트림과 microtask 순서를 제어한 실제 UI 핸들러 테스트에서 변경 전 이전 에이전트 선택지가 남는 실패를 재현했다. 공통 catalog 함수는 시작 시 scopeEpoch를 보관하고 응답 직후 확인해 오래된 목록의 DOM 반영·선택 복원·버튼 갱신을 중단한다.

프로젝트 전환으로 비운 버전 선택과 실행 버튼 잠금을 유지하며 새 범위의 정상 초기화는 계속 진행한다. 버전 내용·불변성·등록 API·기존 데이터를 변경하지 않고 요청을 재전송하지 않는다.


## 최종 통과 응답과 평가·비교·승인 의미의 일치 — v0.112

응답의 전체 판정과 저장된 artifact가 일치하더라도, 비교가 미완료이거나 관리자 승인이 없거나 조회한 평가가 통과하지 않은 상황에서 화면이 최종 통과를 표시할 수 있었다. 실제 UI 핸들러에 자체 서명된 합성 응답을 주어 변경 전 세 실패를 재현했다. 최종 허용은 조회한 완료 평가의 pass와 정책별 허용/평가 통과 상태, 선택한 기준·후보 ID와 완전하고 회귀 없는 비교, 관리자 정책의 명시적 승인 상태를 함께 요구한다. 모순은 확인 실패·명시적 재시도 안내로 처리하고 기록 저장을 활성화하지 않는다.

관리자 정책의 comparison.evaluationPassed와 comparison.deploymentAllowed를 구분한다. 비교 자체가 통과하고 후보의 현재 승인이 유효하면 전체 허용이 가능하며, 비교 통과만으로 승인 대기·반려·만료를 우회하지 못한다. 정상 비교와 관리자 승인 응답의 원본 artifact·해시·서명 저장 및 독립 서명 검증을 유지한다. 화면의 의미 검사는 서버 평가 재실행이나 독립 키의 암호학적 서명 검증을 대신하지 않는다.


## 기준 실행을 포함하는 자동 포트폴리오 시연 — v0.113

`npm run demo:portfolio -- --compare`는 기존 기본 시연을 유지하며 정책별 합성 기준 2개를 추가한다. 6개 평가·6개 게이트의 12단계에서 기준 근거 결합·비교 의미·독립 서명을 확인하고 승인 대기·승인·반려의 최종 허용을 구분한다. 잘못된 기준·모순인 비교·서명 또는 정리 실패는 성공으로 처리하지 않는다. 미완료 기준도 취소하며 승인 후 실패한 후보는 반려로 정리한다. 자체 세션은 종료하고 기존 데이터·키는 보존한다.

실제 로컬 API에서 비교 옵션의 12단계와 서명·정리를 확인했다. 기본 흐름 유지, 두 정책 기준 결합, 서명 검사 성공에도 잘못된 비교 거절, 승인 후 정리와 미완료 기준 취소, 잘못된 CLI 인자의 인증 전 거절, 비교 모드 로그인 응답 크기·UTF-8 경계를 테스트한다. CI 합성 시연 단계에도 비교 옵션을 포함한다. 기존 서버에서 실행한 도구 검증과 새 이미지 실행 검증은 별도로 기록한다.


비교 시연의 원본 artifact도 후보 ID·요청한 고정 버전·후보 및 기준의 스냅샷/결과 해시와 대조한다. 독립 서명 검사가 성공해도 다른 후보의 원본 요청·근거가 섞인 응답은 실패한다. 이 경계의 변경 전 실패를 재현하고 후보·기준·비교 의미의 변조 사례와 실제 API 비교 시연을 다시 확인했다.


## 릴리스 검증 기록 필터 — v0.120

`GET /v1/release-receipts?limit=25&decision=block&candidateRunId=<UUID>`는 판정과 후보 실행을 교집합으로 조회한다. `decision`은 `pass`/`block`, 후보 UUID는 대소문자 입력을 정규화한다. 생략한 조건은 제한하지 않는다. 잘못된 값·중복 조건·알 수 없는 쿼리는 400이다. `limit`/`cursor`가 없으면 기존 배열 응답(최대 100개)을 유지하며, 페이지 요청은 `{items,nextCursor}`를 반환한다. 목록에는 원본 artifact·사례 출력·서명을 포함하지 않는다.

커서는 조직·프로젝트·리소스·필터 조건에 묶인다. 다른 조건의 커서나 CI 키 목록 커서를 전달하면 400이다. 페이지 사이의 새 기록 추가는 첫 페이지의 커서 이전 구간에 끼어들지 않는다. v0.119까지의 검증 기록 커서는 새로고침해 다시 받아야 한다.


`GET /v1/runs/<run UUID>/reviews/<review UUID>`는 현재 조직/프로젝트와 해당 실행에 속한 원래 검토 한 개를 반환한다. viewer/editor/admin 세션으로 읽으며 CI 전용 키는 접근할 수 없다. 잘못된 UUID·쿼리는 400, 다른 조직/프로젝트/실행이나 없는 기록은 404다. 응답은 과거 본문과 reviewHash이며 현재 검토자 권한·현재 승인·새로운 쓰기 권한을 포함하지 않는다.
