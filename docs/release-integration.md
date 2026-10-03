# v0.3 연결·비교·CI 게이트

2026-10-04 구현. 기본 환경은 합성 데이터와 모의 응답을 사용한다. 실제 고객 엔드포인트와 원격 CI 배포는 아직 검증하지 않았다.

## HTTPS 연결

운영자가 `.env`의 `AGENTTRUST_HTTPS_TARGETS`를 JSON 객체로 설정한다: 조직 UUID → 연결 ID → 정확한 HTTPS URL. URL에 비밀을 넣지 않는다. 기본값은 빈 객체다. 연결 ID는 조직 안에서만 찾는다. HTTPS 에이전트 버전은 `name`, `mode: "https"`, `connectorId`, `endpointHash`를 갖는다. endpointHash는 등록한 URL 문자열의 SHA-256 hex다. URL을 변경하면 새 에이전트 버전을 등록해야 한다. 원격 구현 자체의 불변 버전 관리는 연결 대상의 책임이며 이 해시는 원격 코드/모델의 동일성을 증명하지 않는다.

기본 Compose의 worker는 internal backend 네트워크만 사용하여 인터넷 경로가 없다. API/DB는 루프백 포트 게시를 위한 host-access 네트워크에도 연결된다. 외부 평가를 활성화할 때만 운영자가 `docker compose -f compose.yaml -f compose.https.yaml up -d --wait`를 사용한다. 이 opt-in에서는 worker에 인터넷 경로가 생기며 애플리케이션의 조직별 URL/DNS 통제가 적용된다. 목적지별 방화벽 또는 전용 egress proxy는 아직 구현하지 않았다. 임의 코드 실행 기능은 없다.

어댑터는 HTTPS 443, 호스트 이름, 쿼리·인증정보 없는 URL만 허용한다. DNS의 모든 응답이 공인 IPv4여야 한다. IPv6/사설/loopback/link-local/공유·문서화·벤치마크 주소 등을 거절하고 검증한 IP로 연결을 고정한다. 인증서 검증과 호스트 SNI를 유지한다. redirect, 압축 응답, 200 이외 상태, 비 JSON 응답, 64 KiB 초과 응답을 거절한다. 연결당 5초와 기존 전체 실행 시간 예산을 적용한다. 응답/오류를 로그에 출력하지 않는다.

요청: `POST { caseId, input, agentVersionId }`; 응답: `{ output: string, toolEvents: [{ name, args }] }`. 데이터셋의 mock 응답·규칙은 전송하지 않는다. 출력 10,000자, 도구 이벤트 20개와 기존 깊이 제한을 적용한다. 연결 대상 인증용 비밀 헤더는 지원하지 않는다. 인증이 필요한 실제 대상은 별도 비밀 관리 계약을 결정한 뒤 연결한다. 외부 오류는 inconclusive이며 배포를 허용하지 않는다.

## 버전 비교

UI에서 후보 실행을 조회한 다음 기준 실행을 선택해 비교한다. `POST /v1/compare`는 `{ baselineRunId, candidateRunId }`를 받는다. 기존 세션·조직·프로젝트 경계를 그대로 적용한다. 데이터셋과 정책 contentHash가 같아야 한다. 모든 사례·규칙의 완료 증거가 있어야 비교 가능하며 pass → fail/inconclusive 변화는 회귀다. 후보가 pass이고 회귀가 없을 때만 비교에서 배포 허용을 반환한다. 정책 또는 데이터셋이 달라지면 409다.

## CI 게이트

`npm run release:gate`는 로컬 API에 로그인하여 불변 결과를 읽고 검증한 뒤 세션을 로그아웃한다. CI용으로 조회자 키만 전달한다. 키는 환경변수/CI secret으로 주입하며 인수나 로그에 넣지 않는다.

필수 환경변수: `AGENTTRUST_ACCESS_KEY`, `AGENTTRUST_RUN_ID`, `AGENTTRUST_AGENT_VERSION_ID`, `AGENTTRUST_DATASET_VERSION_ID`, `AGENTTRUST_POLICY_VERSION_ID`. 선택: `AGENTTRUST_URL` (기본 http://127.0.0.1:4310/), `AGENTTRUST_BASELINE_RUN_ID`, `AGENTTRUST_MAX_AGE_SECONDS` (기본 600, 최대 86400). 종료 코드 0은 승인, 1은 차단, 2는 검증 오류다. 배포 명령은 반드시 성공한 게이트 뒤에 실행한다. 이 도구 자체는 배포하지 않는다.

검증 조건: succeeded/pass, 정확한 세 버전 ID, 완료 시간의 유효성, 사례·규칙 전체 증거, 스냅샷·결과 해시 일치. 기준 실행이 지정되면 비교도 통과해야 한다. 동일한 검증은 `POST /v1/release-gate`에서 제공한다. 요청은 후보/기준 ID와 기대 버전 ID, maxAgeSeconds를 받는다. 보류·취소·실패·시간 초과·증거 누락·낡은 결과는 승인하지 않는다.

현재 CI 연결은 API와 같은 호스트의 runner 또는 로컬 파이프라인용이다. GitHub 호스팅 runner에서 사용자의 localhost에 접속할 수 없다. 공용 API 노출을 추가하지 않았다. 기존 GitHub 검증 workflow는 이 게이트의 단위/통합 테스트를 실행하며 실제 배포 workflow는 아직 없다. 로컬 조회자 키는 조직의 모든 조회 가능 리소스를 읽을 수 있으므로 운영용으로는 프로젝트 범위 서비스 자격증명/OIDC, 만료·철회 관리가 필요하다.

## 운영 전 결정

실제 HTTPS 계약과 대상 버전 식별, 민감 데이터/보존 정책, 대상 인증, 배포 환경과 runner, OIDC 및 TLS 종단, 비밀 저장소, PostgreSQL 백업·격리된 복원 검증을 확정해야 한다. 지금의 파일 기반 개발 키와 Docker volume은 운영 비밀 관리·백업을 대신하지 않는다.

검증 근거: Node HTTPS의 TLS/lookup 옵션은 [Node 공식 HTTPS 문서](https://github.com/nodejs/node/blob/main/doc/api/https.md)를 기준으로 구현했다. HTTPS 전송은 주입한 합성 transport로 보안 옵션·주소 고정·오류를 검증했고 실제 고객 서버 호출은 수행하지 않았다.

최종 검증: 자동 테스트 33개 통과, Docker 재빌드/health 및 실제 기본 worker egress 차단 확인, 정지·재시작 후 결과·해시·계량·감사 보존 확인, 브라우저 비교 완료(회귀 0개) 확인, npm audit 알려진 취약점 0개.

## v0.4 변경

CI 전용 프로젝트 키와 서버 승인 기록을 추가했다. CLI는 서버에서 검증 기록을 생성하고 요청 일치/아티팩트 해시를 확인한다. 자세한 내용은 [CI 운영 안내](ci-operations.md), [백업·복원 검증](backup-recovery.md)을 따른다. 앞의 v0.3 조회자 키 방식은 호환용으로 남아 있다.

릴리스와 비교의 근거 일관성: 후보와 기준 실행 모두 snapshot/result 해시, 각 버전 원문 contentHash와 실행 version ID의 일치, 사례 입력/ID, 규칙 ID/유형/필수 여부/판정, 규칙 개수·통과율 요약, 정책에서 계산한 게이트와 상태를 확인한다. 바깥 해시를 다시 계산해도 내부 버전이나 규칙/요약이 불일치하면 배포를 허용하지 않는다. 기준 실행이 변조된 경우도 비교 불가로 차단한다. 에이전트를 재호출하거나 저장 출력의 모든 규칙을 재실행하는 절차는 아니며, 저장된 근거 구조와 판정 집계의 일관성을 확인한다. 실제 실행 어댑터·워커·원본 버전 저장의 신뢰 경계는 유지된다. 검증 로직 변경으로 과거 idempotency 결과와 현재 판정이 다르면 409를 반환하므로 새 검증 키로 다시 확인한다.
