# AgentTrust 4310 단일 진입점 전환 계획

작성: 2026-10-31 KST. 상태: **조사·설계만 완료, 미구현·미적용**. 조사 소스 기준 `2bfd8dd`.

이번 요청은 기존 서비스·대화를 유지하는 전환 계획이다. 운영 설정·DB·Keycloak·포트·컨테이너·자동 기동을 변경하지 않는다. 아래 실행 단계는 별도 검증과 전환 실행 승인이 필요하다. 제품 진입점 통합과 실제 CD/운영 복구 완료를 구분한다.

## 1. 현재 확인한 경계

| 영역 | 4310 기존 구현 | 4320 새 스택 | 전환 의미 |
|---|---|---|---|
| 화면/API | `agenttrust-api-1`, JavaScript, 호스트 `127.0.0.1:4310` | Next.js `4320` → BFF `/backend` → WebFlux Gateway → Java Core | 같은 주소로 연결해도 구현·API 계약이 같아지지 않음 |
| 업무 데이터 | `agenttrust-db-1`, DB `agenttrust`, `agenttrust.*` 스키마 | `stack-db`, DB `agenttrust_stack`, `stack_*` 테이블 | 기존 DB URL을 새 Core에 연결하는 방식은 금지 |
| 인증 데이터 | 접근 키·membership·DB 세션 | 별도 DB `agenttrust_stack_identity`, Keycloak OIDC/PKCE | 사용자·역할 대응과 재로그인이 필요함 |
| 세션 쿠키 | `agenttrust_session`, HttpOnly·Strict·Path=/ | `AGENTTRUST_STACK_SESSION`, Core 세션·BFF 필터 | 세션/접근 키를 복사하거나 서로 인증으로 인정하지 않음 |
| 로그인 주소 | 기존 제품 로그인 | origin `http://127.0.0.1:4320`, issuer `http://127.0.0.1:4322/realms/agenttrust` | origin·issuer·콜백·로그아웃·이미지 설정을 함께 검증해야 함 |
| 저장소 | `agenttrust_postgres-data` | `agenttrust_stack-postgres-data`, identity·object·queue 등 별도 상태 | 제품 간 데이터 연결 및 복구 계약 필요 |

읽기 전용 Docker inspect에서 AgentTrust 20개와 LogiTrack 12개 모두 healthy이며 보호 기준의 ID/image/StartedAt이 유지됨을 확인했다. 내용 전체를 조회한 DB 감사나 새로운 복원 훈련을 한 것은 아니다.

현재 소스의 주요 증거:

- `compose.yaml`: 기존 API가 호스트 4310을 점유하고 DB `agenttrust`를 사용한다.
- `compose.stack.yaml`, `compose.stack.identity.yaml`, `compose.stack.gateway.yaml`: 새 화면/API/IdP/Gateway의 별도 포트와 상태 저장소.
- `apps/api/auth.js`: 기존 접근 키/세션과 `agenttrust_session` 계약.
- `apps/console/src/lib/oidc-endpoints.ts`, `services/core-api/src/main/java/dev/agenttrust/core/OidcEndpointPolicy.java`, `scripts/stack-oidc-image-config.py`: local-review가 4320/4322를 정확히 고정한다. 환경변수나 프록시만 바꿔 4310으로 전환할 수 없다.
- `apps/console/src/app/backend/[...path]/route.ts`, `apps/console/src/lib/proxy-policy.ts`: Host·Origin·CSRF·OAuth query·리다이렉트·세션 쿠키의 허용 목록.
- `infra/migrations`, `services/core-api/src/main/resources/db/migration`: 서로 다른 데이터 구조와 불변 기록 계약.
- [기능 이전 범위](stack-feature-parity.md), [OIDC 계약](stack-oidc-endpoints.md), [기존 복구](backup-recovery.md), [새 스택 복구](stack-coherent-recovery.md).

## 2. 목표 구조와 이번에 실행하지 않는 부분

권장 최종 목표는 **브라우저의 제품·로그인 주소까지 `http://127.0.0.1:4310`으로 통합**하는 것이다. 이는 로컬 검토 주소이며 공개 운영 HTTPS 도메인을 정한 것은 아니다.

```text
브라우저 → 127.0.0.1:4310 전용 진입 프록시
  /, /_next/*       → 새 Next.js Console
  /backend/*       → Console BFF → 내부 Gateway → 내부 Core API
  /identity/*      → 명시적으로 허용한 Keycloak 공개 로그인/리소스 경로
                     내부 token/JWK/back-channel 주소는 별도 고정 계약
```

프록시 구현/이미지는 아직 선택·검증하지 않았다. 새 일반 프록시를 현재 4310 앞에 추가 실행할 수는 없다. 기존 API가 이미 그 주소를 점유한다. 최종 인계에는 기존 port binding 변경 또는 기존 API의 정지가 필요하므로 **32개 컨테이너의 현재 ID·StartedAt을 모두 유지하는 조건과 최종 주소 인계는 동시에 달성할 수 없다**. 이번에는 현재 상태를 보존하고 설계·격리 검증까지만 준비한다. OS portproxy, 방화벽 변경, 임의 Host/Origin 위조로 이 충돌을 우회하지 않는다.

단계 중간에 화면만 4310, IdP는 4322인 구성을 검증할 수는 있지만 그것은 제품 화면 진입점만 통합한 상태다. 로그인까지 단일 주소인 최종 완료로 표시하지 않는다.

기존 앱을 `/legacy` 아래로 단순 프록시하는 안은 기본안에서 제외한다. 기존 자산·절대 경로·API·쿠키 경로와 기능의 이중 쓰기 계약이 검증되지 않았다. 초기 이력 보존은 새 화면의 명시적인 읽기 전용 과거 기록 보기로 설계하며, 필요하면 이 별도 기능을 먼저 구현한다. 숨겨진 기존 API 자동 fallback은 두지 않는다.

## 3. 기능 차이와 전환 판정표

아래는 소스/문서 조사 결과이며 설치된 새 이미지가 최신 branch 기능을 전부 포함한다는 증거가 아니다. 실제 전환 후보 digest에서 다시 검사한다.

| 사용자 과업 | 조사 결과 | 전환 전 필수 증거 |
|---|---|---|
| 로그인·역할·조직/프로젝트 | 기존 접근 키와 새 OIDC가 다름. 새 개발용 workspace 등록은 있으나 기업 IdP·구성원 관리 전체 완료는 아님 | 기존 membership→OIDC subject의 검토 가능한 대응, 조회자 쓰기 거부, 교차 조직/프로젝트 거부, 재로그인 |
| 에이전트·데이터셋·정책 | 새 불변 버전·고정/참조 시나리오 구현. 기존 범용 입력을 모두 수용하지 않음 | 실제 사용하는 입력 종류별 지원/읽기 전용 보존/차단 표, 크기·내용·hash·정책 버전 보존 |
| 평가·캠페인·취소 | 새 NATS/워커·요청 복구·캠페인 경로 존재 | 중복 제출·응답 불명·지연 완료·취소·기한 초과·재전달의 실제 E2E |
| 탐색·회귀 비교 | 새 캠페인 사례/현재 페이지 필터 존재. 기존 필터·전체 이력 탐색 전체와 동일하지 않음 | 기존 핵심 조회 과업별 기능 대응 및 이전 기록 식별, 검색 누락/잘림 명시 |
| 승인·반려·현재 게이트 | 두 구현 모두 근거와 현재 승인 상태를 구분하나 저장/서명 계약이 다름 | 반려·필수 실패·누락·만료·정책 변경이 현재 게이트를 차단함. 과거 승인 자동 승계 금지 |
| 서명·보관·감사 | 기존 release receipt와 새 campaign/current-gate·MinIO 근거가 다름 | 원래 바이트·서명·키 ID·신뢰 공개키·출처 검증, 기존 이력의 읽기 전용 표시, 전체/부분 export 구분 |
| CI 연동/API 소비자 | 기존 CI credential/receipt와 새 현재 판정 계약이 다름 | 호출자 목록·경로·토큰·응답 계약 비교. 인증 방식 자동 대체 금지 |
| 복구·재인증 | 과거 격리/합성 증거는 있으나 현재 데이터의 독립 fresh reader·전체 운영 복구는 미완료 | 아래 복구/전환 gate 및 현재 후보의 실제 재인증·데이터 보존 증거 |

최소 전환 범위를 먼저 고정한다. 미지원 과업을 UI에서 조용히 제거하거나 과거 데이터를 새 데이터로 위장하지 않는다. 전체 기능 이전을 완료로 표시하려면 이 표의 미지원 항목을 구현하거나 사용자와 명시적으로 범위를 합의해야 한다.

## 4. 데이터: 이력 보존을 먼저, 쓰기 데이터 이전은 나중에

기본안은 **기존 기록의 원본 보존·읽기 전용 검증과 새 스택의 새 작업을 분리**하는 단계적 전환이다. 이것은 기존 자료를 새 DB에 이전 완료했다는 뜻이 아니다.

1. 다음 구현에서 운영 DB를 변경하지 않는 제한된 메타데이터 인벤토리를 설계한다. 조직/프로젝트·버전·평가 상태·검토·receipt·감사·미완료 작업·사용량을 포함하고, 수량/범위/hash만 공개 안전 요약에 남긴다. 현재 문서 작업에서 실제 인벤토리를 실행한 것은 아니다.
2. 기존→새 ID 대응은 조직·프로젝트·주체·리소스 종류·원본 ID·원본 hash·형식 버전을 포함한다. 같은 UUID나 비슷한 JSON 필드라는 이유로 동일 데이터로 취급하지 않는다. canonical JSON 차이도 명시한다.
3. 기존 서명 자료는 원래 artifact 바이트·서명·공개키와 함께 보존한다. 새 서명으로 다시 감싸 원래 서명을 대체하거나 새 배포 권한으로 인정하지 않는다. 신뢰키 변경/폐기는 별도 승인 사항이다.
4. 원본에서 검증 가능한 암호화 논리 export→독립 격리 import dry-run→행/범위/hash·참조 무결성·RLS·서명·중복/재실행 거부를 검증하는 변환기를 준비한다. 현재 DB 스키마에 기존 dump를 직접 복원하지 않는다. 키·접근 토큰·기존 세션은 이전 대상에서 제외한다.
5. 실제 쓰기 데이터 이전이 필요하면 출처 mapping·명시적인 미지원 목록·검증 가능한 이전 영수증과 재실행 멱등성을 갖춘다. 두 제품으로의 무조건적인 dual-write는 채택하지 않는다.
6. 과거 승인을 새 현재 게이트에 승계하지 않는다. 새 후보·정책·평가기·근거 유효기간에 대해 다시 평가/검토한다.

새 DB·기존 DB·MinIO 버전·NATS·Redis·IdP·서명키는 별도의 상태다. 선택한 암호화 파일 사본이나 DB 한 개의 일관성만으로 시스템 전체 snapshot 원자성을 주장하지 않는다. 운영 데이터와 비공개 bundle은 public CI로 보내지 않는다. 물리 백업 보류 결정도 변경하지 않는다.

## 5. 인증: 4310 계약을 새로 구현해야 함

- `local-review`의 허용 목록을 광범위하게 완화하지 않는다. 예를 들어 `local-single-entry`라는 별도 프로필을 검토하고, 고정 application origin `http://127.0.0.1:4310`, 최종 issuer 경로 `http://127.0.0.1:4310/identity/realms/agenttrust`를 Java/TypeScript/Python·이미지 메타데이터·CLI 계약에 동일하게 정의한다. 이 프로필은 현재 존재하지 않는다.
- Keycloak relative path/hostname, discovery의 issuer·authorization·logout·리소스 URL, 내부 token/JWK/userinfo transport와 back-channel을 함께 설계·검증한다. 문자열 치환만으로 IdP 응답을 위조하지 않는다. `/identity` prefix 지원은 구현·실제 로그인 검증 전까지 제안이다.
- redirect URI는 `http://127.0.0.1:4310/backend/login/oauth2/code/keycloak`, web origin은 정확한 4310 origin, post-logout은 같은 origin의 `/`로 고정한다. PKCE S256·state·nonce·issuer·audience·클라이언트 인증·관리자 전용 scope claim을 유지한다. wildcard redirect/CORS, password grant, TLS 검증 해제는 채택하지 않는다.
- 허용된 Keycloak 공개 경로만 통과시키고 관리자 콘솔/API는 제품 라우팅에 자동 노출하지 않는다. 필요한 로그인 정적 자산·form action·discovery 경로는 실제 브라우저 흐름으로 확정한다.
- 쿠키는 포트만으로 분리된다고 가정하지 않는다. 기존 쿠키를 새 BFF/Core로 전달하지 않고, 새 세션 쿠키만 허용한다. 이름·Path·Domain 부재·HttpOnly·SameSite와 logout 만료를 검사한다. HTTPS 공개 배포는 별도 Secure 쿠키/인증서 프로필을 사용한다.
- origin/issuer가 Console 빌드에 고정되므로 새 후보 이미지와 설정 메타데이터 검증·서명 출처 검증이 필요하다. 기존 서명 이미지에 env만 바꿔 적용하지 않는다.
- 전환/복귀 때 기존 세션을 유지한다고 약속하지 않는다. 명시적인 재로그인과 로그아웃/철회 검증을 한다. 기존 접근 키나 관리자 비밀번호를 새 사용자에게 자동 부여하지 않는다.

## 6. 실행 순서와 중단 조건

| 단계 | 구체 작업/산출물 | 완료 기준 | 현재 상태 |
|---|---|---|---|
| A. 비개입 조사 | 본 문서, 소스/포트/DB/쿠키 경계, 보호 서비스 상태 | 운영 변경 없음, 사실/제안 분리 | 이번 조사 완료 |
| B. 기능·데이터 계약 | 핵심 과업 체크리스트, read-only 이력 형식, 데이터 ID/서명 mapping과 dry-run 설계 | 미지원 자료가 누락/변조 없이 명시됨 | 미구현 |
| C. 단일 주소 인증/라우팅 | 3언어 프로필 계약, 명시적 route allowlist, 이미지 설정 | 정상/변조/다른 origin·issuer·cookie 거부 계약 검사 | 미구현 |
| D. 격리 통합 | public 표준 무료 runner의 합성 DB/IdP/서명키에서 단일 진입점 실제 E2E | 로그인→버전→평가→검토→게이트→export→logout, 모든 브라우저 이동의 origin/경로 확인, fixture 정리 | 미실행 |
| E. 로컬 현재 자료 검증 | resource gate, 최신 source/path, 독립 사본과 reader, 업무 상태/재인증/이력 연결 검증 | 현재 후보 digest/설정/자료에 결합된 실제 증거 | 자원 및 복구 증거 미충족 |
| F. 전환 실행 검토 | 주소/포트 인계·쓰기 경계·진행 작업·재로그인·롤백 목록 | 아래 실행 허가 조건 모두 충족 및 별도 실행 승인 | 미승인·미실행 |
| G. 주소 인계 | 검증된 새 진입점에 4310 인계, 초기 읽기 검증 후 새 작업 개방 | 주소/기능/자료/보호 대상의 실제 수용 확인 | 미실행 |

다음 구현 우선순위는 B의 과거 이력 보존 계약과 C의 명시적인 origin/issuer 프로필이다. 운영 DB의 대량 읽기나 운영 IdP 변경 없이 합성 fixture/오프라인 계약부터 진행한다. D의 새 실제 hosted 실행에는 만료된 Tempo case를 재활용하지 않으며 별도 실행 시간 범위가 필요하다. 단일 주소 검증은 기존 Tempo synthetic warm proof와 다른 증거다.

현재 로컬 Docker 실행 gate는 호스트 여유 2GiB를 13회·20초 간격으로 4분 이상 확인, 진행 1GiB 및 기존 guest/disk 기준이다. 순차 reader/암호화 사전 준비·프로필 개선으로 추가 비용을 줄이되 그 수치 자체를 완화하지 않는다. 실제 측정 없이 메모리 문제가 해결됐다고 판정하지 않는다.

## 7. 복구·롤백과 최종 실행 허가 조건

**실행 전 필수 조건**

- 전환 후보 정확한 커밋의 관련 CI 최종 성공, 실제 이미지/설정/서명 provenance 검증. 문서·오프라인 CI만의 성공은 로그인·배포 증거가 아니다.
- 기능 수용 범위 확정, 기존 이력 접근·서명·조직 경계·새 쓰기 대상 명확화. 기존/신규 DB를 섞는 자동 fallback 없음.
- 4310 소유권 인계와 기존 API 처리 방법 확정. 현재 컨테이너 불변 보존 조건을 어떤 단계에서 해제하는지 별도 실행 승인에 명시. 포트 충돌 시 즉시 중단하며 다른 프로세스를 임의 종료하지 않음.
- 진행 작업과 admission 경계 확정. 새 제출을 차단/대기시키는 전환 절차도 운영 변경이므로 이번에 적용하지 않음. 미완료 작업을 양쪽 worker가 동시에 처리하지 않도록 해야 함.
- 현재 자료·설정·인증·키의 복구 범위와 검증 가능한 논리 복원 증거. 물리/원격 백업 보류, 비원자적 표본, 미포함 이력, 미확정 RPO/RTO를 그대로 명시하고 전체 복구 완료로 표시하지 않음.
- 최신 파일/경로 preflight는 첫 관측부터 300초 이내, ID/image/StartedAt/health 및 여유 자원 보존. 만료된 관측을 새 문서 작성으로 갱신하지 않음.
- 예상 중단/재로그인 영향, 실제 측정 가능한 복구 목표와 중단 기준을 전환 검토에서 확정. 현재 값은 미확정이며 무중단·RPO 0을 약속하지 않음.

**복귀 시나리오를 분리**

1. 새 쓰기를 열기 전: 새 진입점 실패 시 소유 fixture를 정리하고 검증된 이전 포트/설정/이미지 조합으로 복귀하는 절차를 먼저 격리 검증한다. 주소만 돌려도 인증 세션은 재로그인이 필요할 수 있다.
2. 새 쓰기를 연 뒤: 기존 4310 앱으로 주소만 되돌리면 새 DB의 작업이 사라진 것처럼 보일 수 있다. 신규 admission 경계를 닫고 신규 자료·작업·감사를 보존한 뒤 mapping·재전달·중복 방지와 양쪽 데이터의 정합성을 검토한다. legacy rollback은 새 데이터의 역변환과 동일하지 않다. 자동 복귀로 처리하지 않는다.
3. 새 앱의 이전 버전으로 복귀: 동일한 새 DB와 호환되는 이전 후보/스키마 계약일 때만 이미지 복귀를 검토한다. 다운 마이그레이션·DB 덮어쓰기·MinIO 버전 삭제를 자동 수행하지 않는다.
4. Tempo: 과거 warm 역이동의 정상 조회 유지가 건강한 롤백을 보장하지 않는다. 현재 원본/복구/역상태의 독립 cold reader와 전체 예상 trace/span 일치가 별도 조건이다. 암호화 staging 3세트는 reader 복원/실행 증거가 아니다.

32개 서비스가 healthy라는 사실은 라우팅/자료/인증 수용의 필요조건일 뿐 전환 승인이나 실제 CD 성공을 뜻하지 않는다. 이 문서의 단계가 준비됐어도 게시 enablement·merge·운영 파일 변경·배포를 자동 허용하지 않는다.
