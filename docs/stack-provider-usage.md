# 모델 실행 예약 한도 조회

콘솔의 **프로젝트 모델 실행 한도**는 `GET /api/provider-usage`를 통해 실제 PostgreSQL 예약을 조회한다. WebFlux 인증·Redis 요청 한도와 Java의 조직/프로젝트 RLS를 적용하며 임의 조직 선택 경로나 쓰기 API는 제공하지 않는다. 관리자·편집자·조회자 모두 자신의 프로젝트 수치를 읽을 수 있다.

UTC 날짜별 예약 100회 한도와 남은 횟수, Ollama/OpenAI/OpenAI-compatible별 예약·완료·실패/취소·결과 대기 건수를 표시한다. 모델 예약과 동일한 프로젝트 잠금으로 신규 예약의 집계를 보호한다. 합성 평가는 `stack_provider_attempts`에 포함되지 않는다. 실패하거나 취소된 예약도 한도를 되돌리지 않는다.

예약은 모델 호출 전에 저장하는 불변 기록이다. 실제 모델 호출 성공 여부, 실측 입력/출력 토큰 또는 가격별 과금액과 동일하지 않다. 응답의 `countingBasis`는 `immutable-provider-reservations`, `billableUsageMeasured`와 `deploymentAuthority`는 모두 `false`다. 사용자에게 가상의 비용을 표시하지 않는다. OpenAI 공급자 수치가 포함된다고 실제 OpenAI 계정 설정이나 호출을 완료했다는 뜻은 아니다.

조회 시각과 UTC 기준일을 함께 표시하며 최신 예약 여부는 다시 조회해야 한다. 브라우저는 조직·프로젝트, 고정 공급자, 정수 범위, 공급자별 상태 합계, 전체 예약 합계와 잔여 횟수를 검증한다. 오류 또는 변조된 응답에서는 이전 수치를 지운다.

`scripts/stack-provider-usage-smoke.py`는 자체 세션으로 관리자·조회자·다른 조직의 실제 조회를 수행하고 PostgreSQL의 범위별 합계와 TypeScript 검증기를 대조한다. 평가나 모델 호출을 생성하지 않는다. 실측 과금·동적 공급자 가격·실제 유료 OpenAI 계정 검증은 후속 작업이다.

2026-10-11 로컬 API 4개 검증과 실제 브라우저의 한도 조회/실패 정리 및 평가 이력 회귀 2개 검증이 통과했다. TypeScript 45개, Java 71개, 게이트웨이 18개 테스트와 Docker 빌드가 통과했으며, 원격 CI 결과는 해당 커밋에서 별도 확인한다.
