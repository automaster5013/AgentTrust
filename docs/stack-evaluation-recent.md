# 최근 24시간 완료·실행 오류 관측

4310 운영 관측의 최근 24시간 집계를 4320 프로젝트 홈으로 이전한다. 소스 구현과 합성 후보 검증 범위이며 현재 복구 서비스에 적용하지 않는다.

`GET /api/evaluation-recent`는 viewer/editor/admin의 기존 프로젝트 인증 범위에서 읽기만 허용한다. RunService.scoped/RLS와 명시 organization/project 조건을 함께 사용한다. Gateway와 BFF는 정확한 GET 경로만 전달한다. 새 스키마·계정·인증·정책 설정은 없다.

단일 PostgreSQL SELECT의 statement_timestamp()를 관측 시각으로 고정하고 정확히 24시간 전부터 관측 시각까지 양 끝을 포함한다. 완료 시각은 stack_run_results.completed_at이다. 효과적인 상태·판정은 기존 결과 우선 COALESCE 계약을 따른다. 종료 상태 중 그 시간창의 완료 건수를 집계하며 실행 오류는 failed 상태만 센다. block 판정과 succeeded/inconclusive는 실행 오류가 아니다.

과거 terminal 평가에 결과 행이 없어 완료 시각을 모르면 전체 보관 평가 중 완료 시각 미상 건수로 별도 표시한다. 그 건수가 24시간에 포함되는지는 알 수 없다. created_at을 완료 시각으로 대신하지 않는다. 빈 프로젝트도 clock와 lateral aggregate를 통해 검증된 0 한 행을 반환한다. 미래·생성 전 완료 시각, 모순된 상태/판정, 비정상 숫자·부분 응답은 실패로 처리한다.

UI는 명시 조회·취소, 처음과 오류의 미확인 표시, 검증된 0, 재조회·취소·조직/프로젝트/권한 변경과 늦은 응답 제거를 제공한다. 시간창과 완료·실행 오류·시각 미상 건수를 각각 표시한다. 관측은 실행 예약·한도·워커 건강·시간 초과·운영 SLO·현재 게이트·승인·배포 권한이 아니다. deploymentAuthority=false이다.

로컬 검증: Core reader 5/controller 1, Gateway 신규 경로와 기존 RoutePolicy 검사, Console 215개, TypeScript, actionlint 통과. 실제 소스 합성 브라우저 14항목/JS 오류 0(실제 backend 연결 아님): 검증된 0/완료와 미상 분리/foreign·숫자·마이크로초 시간창·달력·401·503 거부/취소·scope·role 변경 late 제거/1440·390. 증거는 작업공간 outputs/evaluation-recent-local-browser-20261112.json.

실제 후보 E2E는 기존 합성 평가만 사용한다. API 시간창을 읽기 전용 PostgreSQL 대조에 전달해 같은 경계를 비교하며 원래 run 행 지문·익명 401·모바일·치환/503/취소와 업무 쓰기 0을 확인한다. candidate-only probe는 GITHUB_ACTIONS=true와 AGENTTRUST_AUDIT_V17_FIXTURE=1에서만 동작한다. 로컬은 구문 검사만 수행했다. 실제 후보 CI 수용은 아직 대기 중이다.
