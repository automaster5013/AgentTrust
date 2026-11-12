# 4320 기능 이전 현황 — 2026-11-12

이 문서는 기존 작업 브랜치 `codex/audit-release-integration-20261104`의 최신 기능 문서와 후보 검증을 연결한다. 기본 브랜치 병합이나 현재 복구 서비스 배포를 의미하지 않는다. 전체 이전 대상 목록이 확정되지 않아 완료율을 산출하지 않는다.

## 후보 수용을 마친 기능

아래 결과는 각 정확한 소스 SHA의 **격리된 합성 후보 환경에서 실제 API·브라우저를 검증한 결과**다. 현재 복구 4320에 이 소스를 적용하지 않았다. 각 수용 실행의 게시·배포 작업은 건너뛰었으며, 기능별 권한·지원 한계·산출물 해시는 연결된 문서를 따른다.

| 기능 | 구현·검증 범위 | 후보 CI |
|---|---|---|
| 평가 규칙별 관측 비교 | [기능 문서](stack-run-comparison.md) | [수용 실행 43105619197](https://github.com/automaster5013/AgentTrust/actions/runs/43105619197) |
| 에이전트·데이터셋 통합 카탈로그 | [기능 문서](stack-registered-catalog.md) | [수용 실행 43113930712](https://github.com/automaster5013/AgentTrust/actions/runs/43113930712) |
| 데이터셋 새 초안 복사 | [기능 문서](stack-dataset-copy.md) | [수용 실행 43124941613](https://github.com/automaster5013/AgentTrust/actions/runs/43124941613) |
| 고정 정의 전체 확인 | [기능 문서](stack-version-definition-inspection.md) | [수용 실행 43132334594](https://github.com/automaster5013/AgentTrust/actions/runs/43132334594) |
| 완료 평가 관측 JSON 저장 | [기능 문서](stack-evaluation-result-export.md) | [수용 실행 43138076660](https://github.com/automaster5013/AgentTrust/actions/runs/43138076660) |
| 프로젝트 버전 등록 용량 | [기능 문서](stack-version-capacity.md) | [수용 실행 43143087530](https://github.com/automaster5013/AgentTrust/actions/runs/43143087530) |
| 프로젝트 전체 평가 현황 | [기능 문서](stack-evaluation-overview.md) | [수용 실행 43150063234](https://github.com/automaster5013/AgentTrust/actions/runs/43150063234) |
| 캠페인 사례별 규칙·근거 확인 | [기능 문서](stack-campaign-case-inspection.md) | [수용 실행 43155287834](https://github.com/automaster5013/AgentTrust/actions/runs/43155287834) |
| 프로젝트 서명 관측 메타데이터 탐색 | [기능 문서](stack-receipt-history.md) | [수용 실행 43161144996](https://github.com/automaster5013/AgentTrust/actions/runs/43161144996) |
| 목록 선택 서명 관측 상세 | [기능 문서](stack-receipt-inspection.md) | [수용 실행 43166626066](https://github.com/automaster5013/AgentTrust/actions/runs/43166626066) |

## 최근 추가 수용

[최근 24시간 완료·실행 오류 관측](stack-evaluation-recent.md): 소스 `03ce3b68ff1c3450eeb973d1671c9d198e831a83`, [수용 실행 43174039195](https://github.com/automaster5013/AgentTrust/actions/runs/43174039195) 성공. 새 실제 API·브라우저 시나리오와 동일 시간창 PostgreSQL 대조를 확인했다. 게시·배포 작업은 모두 건너뛰었다. 완료 시각 미상은 전체 보관 범위의 별도 수치이며 최근 24시간 포함 여부를 추정하지 않는다. 현재 복구 서비스 적용은 아니다.

[합성 고정 시나리오 예제 초안](stack-synthetic-dataset-draft.md): 소스 `a114b2c5cfc06a26a826f4a2d6c07f9089299c0c`, [수용 실행43187811384](https://github.com/automaster5013/AgentTrust/actions/runs/43187811384) 성공. 준비·편집·명시 등록과 조회자403을 실제 후보에서 확인했다. 기존 connector의 임의 규칙·도구 이벤트·관리자 정책 프로필 전체 이전은 아니다. 초기 실패 및 등록/상세 시각 정밀도 수정 이력은 기능 문서에 보존했다. 현재 서비스 적용은 없다.

[확인한 요청 관측 JSON 저장](stack-gate-check-export.md): 소스 `bf1b812fa4fba5e75b03d3516c17e6b9aab021fa`, [수용 실행43195931274](https://github.com/automaster5013/AgentTrust/actions/runs/43195931274) 성공. 실제 서명 응답과 다운로드 바이트·Ed25519/hash, 저장 추가 요청0·만료/실패/취소 파일0을 확인했다. 파일은 개발용 과거 요청 관측이며 현재 배포 권한·운영 신뢰를 부여하지 않는다. 실제 서비스 적용은 없다.

[기록된 합성 출력의 문자열 규칙 평가](stack-recorded-text-rules.md): 최종 소스 `23c810c769a59477308d3fd3df7aba39c2487bb4`, [수용 실행43212375508](https://github.com/automaster5013/AgentTrust/actions/runs/43212375508) 성공. 새 editor/viewer 두 시나리오에서 명시 등록→캠페인→전용 NATS/Python→규칙 근거 조회와 실제403을 확인했다. 첫 후보 기동 실패와 생성 큐 저장 한도 수정 이력은 기능 문서에 남겼다. 문자열 contains/not_contains만 지원하며 도구 이벤트·JSON Schema·정책 전체 이전은 미완료다. 게시·배포 작업은 모두 skipped이며 현재 서비스 적용은 없다.

## 남은 주요 범위

프로젝트 생성·전환·구성원, 정책 관리, 동적 공급자 설정, 범용 데이터셋, 기존 서명 자료 전체 연결은 별도 미완료 범위다. 신뢰 멤버십·RLS·세션 결합 계약과 필요한 변경 승인이 선행돼야 하는 기능이 있다. 요청의 projectId를 인증 주체에 주입하거나 정책 조회 권한을 넓혀 우회하지 않는다.

범용 데이터셋의 첫 제한 범위인 [기록된 합성 출력의 문자열 규칙 평가](stack-recorded-text-rules.md)는 합성 후보 수용을 마쳤다. [계약 검토](stack-recorded-text-rules-design.md)에 따라 기존 `quality` 분류와 새 불변 계약으로 `contains`/`not_contains`의 등록→실행→근거 조회를 연결한다. 새 시나리오 CHECK 변경이나 기존 고정·참조 계약 재해석은 하지 않는다. 도구 이벤트·JSON Schema·정책 전체 이전과 구분한다.

후속 [기록된 도구 관측·구조화 출력 규칙](stack-recorded-connector-rules.md)은 [계약](stack-recorded-connector-rules-design.md)에 따라 제한 소스를 구현하고 후보 수용을 준비한다. 실제 도구 호출 없이 허용 도구·인자와 평면 문자열 객체 스키마를 평가한다. 로컬 검사와 실제 소스 합성 브라우저 검사를 통과했으며, 새 후보의 실제 API·브라우저 수용 전이다. 전체 JSON Schema·관리자 정책 이전 완료로 계산하지 않는다.

현재 원본 보존·운영 HOLD·실제 배포 금지 상태를 유지한다. 계정·인증 설정, DB 마이그레이션, 원본 저장소 변경은 이 개발 작업의 범위가 아니다. 전체 운영 완료에는 승인된 배포·복귀 절차와 운영 안정성 수용이 추가로 필요하다.

## 보존된 과거 기록과 현재 복구 상태

README의 2026-10-29 자동 기동 결과와 2026-11-02 Console 적용은 당시의 검증 이력이다. 현재 환경의 자동 복구 보장을 뜻하지 않는다. 11월 11일 Windows Update 재부팅 후 명시적 지시에 따라 11월 12일 격리 복구 환경을 기동했다. 현재는 원본을 읽기 전용으로 보존하며 별도 복사 저장소의 서비스를 유지한다. 반복 중단의 다른 원인은 아직 확정하지 않았다. 안정성 감시는 읽기 전용이며 자동 재연결·재기동·전원/업데이트 정책 변경을 적용한 상태가 아니다.
