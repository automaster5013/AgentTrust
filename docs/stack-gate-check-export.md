# 확인한 요청 관측 JSON 저장

4320 캠페인의 기존 명시적인 현재 판정 서명 확인 후, 검증된 요청 관측을 JSON으로 저장한다. 4310의 current-receipt-download 작업 흐름 중 현재 4320의 개발용 요청 서명 계약에 맞는 범위다. 기존 4310 서명 기록·운영 배포 토큰 전체 이전은 아니다.

사용자가 먼저 현재 판정을 확인해야 한다. 기존 gate-trust·캠페인 evidence·nonce gate-check 인증 GET 및 verifiedCampaignArchive/verifiedGateCheck를 재사용한다. 새 API·쓰기·권한·설정·DB 변경은 없다. 저장 버튼은 새 판정 조회나 서명을 요청하지 않으며 확인한 결과만 저장한다. 명시적인 확인 취소도 제공한다.

파일 kind는 verified-development-gate-check-observation, historicalEvidenceOnly=true, currentDeploymentAuthority=false, operatingTrustEstablished=false이다. JSON wrapper는 정규화된 표현이고 API 원문 바이트가 아니다. 내부 signedCheck는 원래 검증한 payload Base64·hash·byte count·Ed25519 서명·key ID를 유지한다. 공개 개발용 SPKI 키만 포함하며 운영 독립 신뢰를 확립하지 않는다. 실제 보관 원문 전체·최신 검토·배포 권한을 파일만으로 재확인할 수 있는 것은 아니다. 파일을 저장해도 서명의 최대30초 유효 시간이 연장되지 않는다.

원래 서명 payload의 필드를 삭제하면 서명이 깨지므로, payload 안에 기존 검증 후 정규화한 게이트·비교 기준·버전 상태와 다른 추가 필드가 있으면 저장용 관측 자체를 거부한다. v1/v2/v3의 원래 scope envelope를 복원해 비교하며 서명 payload 바이트를 변경하지 않는다. 외부 응답·신뢰 응답의 미검증 추가 필드는 명시 허용 목록으로 제외한다. 파일 한도는64KiB다. 기존 검증 엔진·신뢰 정책을 새로 만들지 않는다.

확인 상태는 actor·조직·프로젝트·role과 전체 선택 캠페인 내용에 결합한다. 선택 ID가 같아도 부모 내용이 바뀌면 제거한다. 새 조회·취소·실패·비활성화·scope/role변경·late 응답은 파일0이다. 저장 직전에도 wall/monotonic 만료를 함께 확인한다. Blob URL은 정리한다. 저장된 파일은 과거 관측으로 취급하며 현재 게이트·배포 준비로 사용하지 않는다.

로컬 Console222개/TypeScript/actionlint 통과. 실제 소스 합성 브라우저13항목/JS0(actual_backend_connected=false): 원래 payload·서명의 실제 Ed25519 확인/명시 저장만/추가요청0/미검증 외부 필드 제외/foreign·서명·중첩추가필드·401·503 거부·파일0/취소late/동일ID부모내용변경/role변경late/만료포커스/1440·390. 단위 검사는 v1/v2/v3 파일 payload 보존과 범위·서명·wall/monotonic 만료도 확인한다. 증거 outputs/gate-check-export-local-browser-20261112.json 및 gate-check-export-console-tests-20261112.log.

후보 E2E는 기존 합성 캠페인을 사용해 실제 요청 서명과 파일을 대조하고 Node Ed25519/hash, 익명401, 저장시추가서명요청0, 변조/503/취소late/만료/모바일, 원래 campaign·receipt 이력 불변·업무쓰기0을 확인한다. 후보 수용은 대기 중이다. 원본·현재 복구 backend 접근과 실제 배포는 수행하지 않는다.
