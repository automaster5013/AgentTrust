# 프로젝트 전체 캠페인 이력 검색

현재 프로젝트의 저장된 캠페인을 승인 필요 설정·불변 에이전트 버전 UUID로 검색한다. 캠페인이 선택되어 있으면 같은 데이터셋 버전으로 범위를 제한한다. 기존의 현재 페이지 필터와 별도로 동작하며, 과거 4310 자료 import나 범용 회귀 정책의 전체 이전은 아니다.

## 실제 기능 경로

Next.js `CampaignHistorySearchWorkspace` → 읽기 전용 BFF → 인증·Redis 한도를 유지하는 Gateway → Java `CampaignHistorySearchController` / `CampaignHistoryReader` → 기존 강제 RLS와 동일 조직·프로젝트의 `stack_campaigns`를 사용한다. 새 테이블·migration·쓰기 API·Python 평가 실행 변경은 없다. 근거 열기와 비교 기준 선택은 기존 Java/Python 평가 결과·회귀 비교 경로로 이어지며 적합성과 현재 게이트는 기존 API가 다시 검증한다.

`GET /api/campaign-history-search/{dataset}/{approval}/{agent}` 및 뒤에 검색 경계를 붙인 경로만 허용한다. dataset/agent는 `all` 또는 소문자 canonical UUID, approval은 `all|required|not-required`다. 임의 쿼리와 쓰기 메서드는 거부한다. SQL 조건은 바인드 변수이며 전체 저장 이력에서 먼저 조건을 적용한 뒤 `created_at DESC,id DESC`의 keyset 페이지를 반환한다. 26번째 일치 행이 있을 때만 25번째 행의 다음 경계를 발급한다.

경계는 검색 도메인·조건 SHA-256 및 기존 CMP 경계(조직·프로젝트·데이터셋·마이크로초 시간·ID)를 결합한 113바이트/151자 base64url 값이다. 다른 조건·데이터셋·주체 범위와 비정규 인코딩은 거부한다. 이것은 탐색 경계이며 서명·인증 토큰·릴리스 권한이 아니다.

브라우저는 응답의 필드 집합·범위·조건·행 순서·중복·행별 조건 일치와 마지막 행에 결합된 경계를 검증한다. 조건/주체/데이터셋 변경은 이전 결과와 탐색 경계를 비우고 진행 요청을 취소한다. 늦은 응답은 표시하지 않는다. 본문까지 제한 시간이 있는 기존 조회 도구를 사용하고 100페이지 탐색 한도를 유지한다. 이전 Core의 미지원/연결 오류는 빈 검색 결과로 표시하지 않는다.

## 검증 범위

2026-11-03 로컬 소스 검증: 콘솔 계약 176개와 TypeScript 검사, 새 Core 경계·검색 reader 테스트 5개 및 Gateway 테스트 2개 통과. 작은 힙의 로컬 프로세스로 검사했으며 Docker/운영 DB/IdP/서비스를 변경하지 않았다. Java 검색 reader 검사는 실제 RLS transaction wrapper 호출, parameter SQL, 26행 lookahead와 정확한 마지막 행 경계, 잘못된 범위에서 DB 접근 전 거부를 검사한다. 실제 PostgreSQL 실행 증거는 아니다.

`stack-campaign-history-search-smoke.py --execute`는 disposable hosted guard 아래 실제 OIDC·BFF·DB의 최대 3페이지를 7조건 조합으로 대조하고 조회자·다른 조직·변경 조건·쓰기/쿼리 거부와 본인 세션 정리를 검사한다. CI의 후보 통합 및 복구 후 후보 검증에 연결했다. 브라우저 시나리오는 페이지 이동·조건 변경·오염 응답 거부·390px 근거 열기와 이전 Core의 명시적 미지원을 확인하도록 추가했다. 이 문서 작성 시 해당 새 소스의 hosted 실행과 운영 적용은 미검증이다.

기존 showcase/공통 Top의 검증·서명된 `43d7801` 후보는 별도 보존한다. 이 기능은 별도 개발 브랜치이며 자동 병합·운영 배포하지 않는다. 운영 4320 Core D40의 미지원 경로를 새로 지원한 것처럼 주장하지 않는다.
