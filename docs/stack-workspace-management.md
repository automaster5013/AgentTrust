# 4320 프로젝트·접근 키·앱 세션 관리

2026-10-31 소스 구현. **현재 서비스 미적용, 실제 DB/Keycloak 통합 검증은 해당 후보 CI 결과로 별도 확인한다.** 기존 4310 자료·계정·세션·CI 키를 자동 이전하지 않는다.

## 이번 기능 범위

| 기능 | 구현 | 미지원/별도 범위 |
|---|---|---|
| 현재 프로젝트 설정 | 현재 인증된 조직/프로젝트 이름·설명 조회, 관리자 저장, revision 조건부 갱신 | 새 프로젝트/조직 생성·선택 전환·구성원/역할 변경 |
| 접근 키 | 프로젝트 관리자 발급·최근 25개 목록·철회, 활성 최대 10개, 1~30일 | 기존 CI 키/릴리스 권한, 평가/승인/일반 API 권한 |
| 내 앱 세션 | 현재 Core에서 관측한 동일 조직·프로젝트·actor의 앱 세션 25개까지 조회·다른 본인 앱 세션 종료 | 다른 사용자의 종료, 현재 세션 종료, 전체 기기/분산 세션, Keycloak SSO 전체 철회 |

화면은 4320의 `프로젝트·계정 관리` 사이드바에 연결한다. 모든 사용자가 현재 프로젝트를 읽을 수 있지만 설정 저장과 키 관리는 관리자만 가능하다. 현재 세션은 기존 상단 로그아웃을 사용한다. 다른 앱 세션만 종료해도 Keycloak SSO 세션이 남아 다시 로그인될 수 있으며 이를 계정 전체 차단으로 취급하지 않는다.

## API와 데이터 경계

- `GET/POST /backend/workspace/project`: 입력으로 조직/프로젝트를 받지 않고 인증된 principal의 scope만 사용한다. 이름/설명 수정은 기존 평가·정책·승인 권한을 바꾸지 않는다. 기대 revision이 달라지면 409이며 자동 덮어쓰지 않는다.
- `GET/POST /backend/workspace/access-keys`, `POST /backend/workspace/access-keys/{id}/revoke`: CSRF와 역할/프로젝트 경계를 유지한다. POST의 키 UUID는 요청 식별자이며 같은 UUID의 발급을 재시도해도 원문을 다시 주지 않는다. 네트워크 실패 후에는 목록을 확인하고 필요하면 철회 후 새 요청을 한다.
- `GET /backend/workspace/sessions`, `POST /backend/workspace/sessions/{id}/revoke`: 공개하는 UUID handle은 실제 세션 쿠키/ID가 아니다. 현재 세션 종료는 409, 타인/다른 scope handle은 404다. 원래 HttpSession의 인증 주체가 달라지면 오래된 handle로 새 주체의 세션을 종료할 수 없다.
- browser → Next.js BFF → WebFlux Gateway → Java의 정확한 management 경로만 추가한다. 기존 세션·Origin·CSRF·크기·quota 경계를 유지한다. BFF/Gateway에 임의 Authorization 전달을 추가하지 않는다.
- Flyway `V18`은 프로젝트 설정 revision, 키 hash, 철회 기록 세 테이블을 추가한다. 강제 RLS와 scope 정책, API 역할의 SELECT/INSERT만 허용하며 UPDATE/DELETE는 허용하지 않는다. 기존 마이그레이션과 4310 DB는 변경하지 않는다. 운영 DB에 이번 migration을 실행하지 않았다.
- 프로젝트 설정/키 발급/철회는 같은 DB transaction에서 감사 기록을 남긴다. 세션 목록은 메모리 기반 관측이며 영속 감사/분산 세션 저장소와 동일하지 않다.

## 조회 전용 키의 실제 사용 범위

키는 256-bit 난수 secret을 사용한다. DB에는 SHA-256 hash만 저장하고 원문은 발급 응답에서 한 번만 반환한다. 키·내부 token 객체의 문자열 진단은 원문을 숨긴다. 목록에는 secret/hash를 반환하지 않는다. UI 원문은 메모리에만 두며 숨기기·다른 관리 작업·메뉴/탭 이동·페이지 종료 시 제거한다. 자동 클립보드 복사나 localStorage 저장을 하지 않는다.

**키가 허용하는 것은 Java의 `GET /api/access-key/project` 하나**다. 현재 로컬 검토 구성은 `http://127.0.0.1:4321/api/access-key/project`다. `Authorization: Bearer <발급된 키>`를 헤더로 보내며 URL/query에 넣지 않는다. 해당 엔드포인트는 별도 stateless 보안 체인을 사용하고 브라우저 쿠키만으로 인증하지 않는다. 유효기간·프로젝트/조직/키 ID·hash·철회 상태를 검사한 뒤 프로젝트 이름/설명만 반환하며 `deploymentAuthority=false`다. 다른 경로의 권한이나 OIDC 사용자 역할로 바뀌지 않는다.

이 키는 Keycloak 로그인/로그아웃과 별도의 수명이다. 계정 폐기·조직 탈퇴·운영 IdP 연동 시 키 자동 철회 정책은 아직 구현하지 않았다. 일반 업무 데이터·CI 게이트로 범위를 넓히기 전에는 이 정책과 Gateway/외부 ingress 인증·quota 계약을 별도로 설계해야 한다. 현재 개발 API 진단 포트를 일반 운영 공개 방식으로 채택했다는 뜻도 아니다.

## 검증

- 로컬 Core 전체 207개, Gateway 51개, 콘솔 165개 테스트 및 TypeScript 검사 통과. Core는 JDK 25에서 Java 21 release target으로 컴파일/시험했으며, 실제 Java 21 런타임은 고정 이미지 CI에서 별도 확인한다.
- 새 테스트는 관리자 권한 선검사, stale revision, 단회 발급/hash 저장, 다른 scope/secret·철회 거부, 문자열/부울/소수 숫자 치환 거부, 실제 stateless Spring filter chain의 읽기·쓰기 거부 및 세션 미생성, 세션 주체 변경/현재·타인 세션 거부를 검사한다.
- `stack-http-smoke.py`에 실제 설정 저장·scope/권한·stale revision·조회 키 사용/철회·다른 본인 앱 세션 종료와 별도 SSO 로그아웃 정리를 추가했다. `stack-database-smoke.py`에 새 테이블의 강제 RLS/append-only 권한/교차 scope 거부를 추가했으며 테스트 쓰기는 rollback한다.
- `workspace.spec.ts`에 실제 로그인 후 설정 저장·단회 키 표시/숨기기·철회·세션 조회 시나리오를 추가했다. 읽기 전용 캡처에서는 이 쓰기 시나리오를 실행하지 않는다.
- 위 실제 DB/IdP/브라우저 시나리오는 일회성 CI fixture에서 실행하도록 연결했으며, 현재 PC의 운영 자료/키/세션에 실행하지 않았다. 실행 전 상태를 성공으로 표시하지 않는다.

Core/DB/Gateway/Console 적용은 새 후보 이미지와 V18 검증이 함께 필요하다. 현재 32개 서비스·이미지·ID·StartedAt을 유지한 채 이 소스를 적용했다고 주장하지 않는다. 운영 배포·게시 enablement·PR merge·기존 서비스 재시작은 이번 범위가 아니다.
