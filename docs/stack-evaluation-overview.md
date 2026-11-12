# 프로젝트 전체 평가 현황

4310 운영 관측의 전체 보관 실행·진행 중 집계를 4320의 현재 프로젝트 범위로 이전한다. 기존 최근 최대 50건 목록과 구분하여 캠페인의 개별 평가를 포함한 전체 저장 평가를 집계한다. 4310 조직 전체 등록 한도나 잔여 실행 용량은 구현하지 않는다. 현재 RunService 등록 계약에 없는 한도를 추가하지 않는다.

인증 GET `/api/evaluation-overview`는 기존 RunService.scoped/RLS 및 명시 조직·프로젝트 조건을 사용한다. 단일 aggregate SELECT에서 stack_runs와 stack_run_results를 연결하고 기존 상세·목록과 같은 COALESCE 상태·판정을 관측한다. 전체 보관 수, queued/succeeded/failed, pass/block/inconclusive, 관측 시각을 반환한다. 두 분류의 합계는 각각 전체 수와 일치해야 하며 queued/failed의 다른 판정, 부분·음수·정밀도 손실 값은 거부한다. 조회자는 읽기만 가능하고 익명은 401, Gateway/BFF는 정확한 GET만 허용한다.

홈 화면의 명시적 조회·취소는 실패·재조회·범위 변경 시 기존 집계를 제거하고 늦은 응답을 거부한다. 초기·실패는 0이 아닌 미확인이다. 집계는 조회 시점의 관측이며 대기 상태는 이후 바뀔 수 있다. 용량 예약, 등록 한도, 운영 SLO, 현재 게이트·승인·배포 권한을 나타내지 않는다. `deploymentAuthority=false`를 검증한다.

후보 전용 DB 대조 도구는 GITHUB_ACTIONS와 합성 fixture 플래그를 모두 요구하고 읽기 전용 트랜잭션에서 숫자와 원래 stack_runs 행 지문만 반환한다. 원본·복구 서비스에 실행하지 않는다. 완료 결과는 worker가 별도로 추가할 수 있으므로 결과 테이블 전체 불변을 주장하지 않는다. API·화면·권한·모바일·오류·치환·취소를 로컬 합성 검사와 정확 SHA 후보 CI로 구분하여 검증한다. 현재 복구 4320에는 배포하지 않는다.

프로젝트 생성·전환·구성원, 정책 관리, 동적 공급자 설정 및 전체 4310 자료 이전은 이 범위에 포함되지 않는다.

로컬 검증: Core reader 5건·controller 1건, Gateway 새 경로 1건·기존 경로 21건, Console 202건, TypeScript 및 actionlint 통과. 실제 소스 컴포넌트를 사용한 합성 브라우저 11항목·JavaScript 오류 0: 전체 70건·검증된 0건·범위/합계 치환·401/503·취소/범위 변경 후 늦은 응답·1440/390 폭을 확인했다. 실제 backend 연결은 false이며 후보 수용 전이다. Java 25의 로컬 검사는 운영 Java 21 검증을 대신하지 않는다.

최종 후보 수용: SHA 9c98d8bad012be4cce8a77825151a4af95fc8cb1 / GitHub Actions 43150063234 성공. security-source·Windows·integration 통과, 모든 게시·배포 작업 skipped. 새 전체 현황 브라우저 시나리오가 실제 API/Postgres 집계·원래 run 행 지문 불변·익명 401·치환/503/취소 응답 제거·1440/390·업무 쓰기 0을 검증했다. artifact 13914463271 (7036 bytes), ZIP SHA256 12001a81d32c55a9623dd0d87d212ecd5e0c77283042454c58f1b72a26832c1b 대조. 증거 outputs/evaluation-overview-acceptance-20261112.json. 합성 후보의 수용이며 현재 복구 서비스 적용이나 전체 4310 이전 완료는 아니다. 동일 성공 SHA/run은 다시 실행하지 않는다.
