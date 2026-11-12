# 프로젝트 서명 관측 기록 탐색

4310 receiptHistory의 프로젝트 전체 기록 탐색을 4320 캠페인 서명 관측 메타데이터로 이전한다. 기존 선택 캠페인별 최대 50개 목록과 별도로 프로젝트 전체 또는 캠페인 ID 조건으로 최신순 25개와 다음 페이지를 조회한다. 4310 후보 실행 ID와 4320 캠페인 ID는 다른 계약이다. 기존 4310 서명 자료 전체 연결이나 판정 필터 이전은 아니다.

인증 GET `/api/receipt-history[/campaign/{UUID}][/page/{cursor}]`는 기존 local-development 서명 모드에서만 제공한다. 모드·키·인증 설정을 바꾸지 않는다. RunService.scoped/RLS와 명시 조직·프로젝트 조건, optional campaign_id 및 정확한 created_at/id 내림차순 경계를 사용한다. LIMIT 26 중 25개를 표시하고 마지막 표시 행으로 다음 경계를 만든다. 별도 RCP 도메인의 80바이트/107자 cursor는 조직·프로젝트·캠페인 필터·마이크로초·ID를 결합한다. cursor는 탐색 경계이며 권한이 아니다.

응답은 id/campaignId/keyId/createdAt만 포함한다. keyId는 공개 키의 식별 해시이며 키 원문이 아니다. 테이블에 decision 열이 없으므로 payload를 SQL에서 임의 해독하거나 새 판정 필터를 만들지 않는다. payload·서명 원문·노트·actor·요청 키는 목록에 내보내지 않는다. `signatureVerificationPerformed=false`, `deploymentAuthority=false`를 검증한다. 목록에 존재한다는 사실은 서명 유효성이나 현재 게이트·승인·배포 권한을 증명하지 않는다.

UI는 기존 signingEnabled일 때만 표시한다. 명시 조회·다음 페이지·최신 페이지·캠페인 필터·취소가 있으며 초기/실패는 빈 목록이 아닌 미확인이다. 필터·범위·역할 변경, 실패·취소·늦은 응답 시 기존 목록을 제거한다. 행의 캠페인 근거 열기는 기존 inspect 경로의 scope·버전 내용 해시·현재 게이트 조회로 연결한다. 서명 발급·검토·승인을 자동 실행하지 않는다. 원문·서명 검증은 기존 선택 캠페인의 관측 기록 확인 작업에서 수행한다.

로컬 Core reader 4건·cursor 3건·controller 1건, Gateway 신규 경로 1건·기존 21건, Console 209건, TypeScript·actionlint 통과. 실제 소스 합성 브라우저는 17항목·JS 오류 0: 25개와 다음 페이지, 같은 시각 ID/마이크로초 경계, 필터, 캠페인 열기, 범위·필터·cursor·키·권한 주장 치환, 401/503, 검증된 빈 목록, 취소·필터·scope 변경 후 늦은 응답, 1440/390을 확인했다. 실제 backend 연결은 false다.

후보 E2E는 기존 합성 서명 기록만 읽고 API 메타데이터를 읽기 전용 PostgreSQL 조회와 대조한다. 원래 receipt 행 지문 불변·익명401·기존 캠페인 근거 열기·오류/치환 제거·모바일·쓰기0을 검증한다. 기존 실제 후보 데이터가 25개를 넘는다는 전제를 만들지 않으며 실제 DB 다중 페이지 수용을 주장하지 않는다. cursor·쿼리·합성 브라우저 페이지 검증과 실제 API 수용을 구분한다. 새 서명 fixture 발급이나 원본·현재 복구 backend 접속, DB 스키마 변경, 실제 배포는 하지 않는다.
