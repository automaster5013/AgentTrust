# AgentTrust

[![Validate and deliver](https://github.com/automaster5013/AgentTrust/actions/workflows/validate.yml/badge.svg?branch=main)](https://github.com/automaster5013/AgentTrust/actions/workflows/validate.yml)

AI 에이전트의 품질과 보안을 평가하고, 검증 증거를 바탕으로 배포 결정을 지원하는 플랫폼.

현재 단계: v0.45 기업 개발팀의 평가 실행·관리자 검토·CI 릴리스 게이트를 로컬 Docker에서 구현했다. 저장된 근거와 규칙의 일치, 조직 격리, 만료·철회와 잠금 대기 후 권한 재확인, 불변 서명 기록, 암호화 백업과 격리 복원을 검증한다. 사례 검색·필터·페이지 조회와 초기 화면 준비 상태를 제공하며 전체 178개 테스트가 통과했다. GitHub Actions의 전체 검증과 GHCR 이미지 발행을 실제로 확인했다. 후보 digest의 별도 실행 검증 후 main 이미지로 승격하는 단계를 제공한다. 실제 고객 모델 연동·상용 서버 배포는 아직 수행하지 않았다.
작업 루트: `C:\AgentTrust`; 독립 Git 저장소의 `main` 브랜치.

## 포트폴리오 시연

`npm run demo:portfolio`로 합성 평가 4개와 최종 게이트 6개를 재현한다. 통과·차단·증거 누락과 관리자 승인 대기→승인→반려, 서명 검증을 확인한다. [설치와 화면 시연 절차](docs/portfolio-demo.md)를 따른다. `npm run demo:roles`는 작성자의 평가 생성, 조회자의 근거·게이트 확인, 관리자의 승인·반려와 권한·조직 경계 거절을 재현한다. 실제 배포는 수행하지 않는다.

[기술 설명과 검증 근거](docs/portfolio-engineering.md)에서 설계 선택·재현 명령·코드와 테스트 위치·남은 제한을 확인할 수 있다. [실제 아키텍처](docs/architecture.md)는 구현된 평가·승인·이미지 전달 흐름을 설명한다.

## 설계 문서

- [GitHub CI와 Docker 이미지 전달·수동 배포 준비](docs/github-delivery.md)
- [6시간 자율 개발 결과와 인수인계](docs/autonomous-development.md)
- [제품 비전과 범위](docs/product.md)
- [위협 모델](docs/threat-model.md)
- [시스템 아키텍처](docs/architecture.md)
- [단계별 로드맵과 출시 조건](docs/roadmap.md)
- [다음 구현 작업](docs/next-implementation.md)

## 핵심 원칙

평가 실패·시간 초과·증거 누락은 통과로 처리하지 않는다. 평가 결과는 특정 에이전트 버전, 데이터셋 버전, 정책 버전과 연결한다. 점수는 위험 제거를 보장하지 않으며 정책에 명시한 범위 안에서 해석한다.

첫 고객은 기업 개발팀으로 확정했다. 배포 지역, 데이터 보존 기간, 결제 방식은 확정 전이다. 기본 가정은 기업 개발팀을 대상으로 한 단일 리전 SaaS이며 초기 개발에서는 합성 데이터와 모의 에이전트를 사용한다.

## 로컬 실행

[개발 안내와 API 계약](docs/development.md)을 참고한다. Node.js 24와 Docker Desktop에서 npm.cmd ci --cache .cache/npm → npm.cmd run setup → npm.cmd run docker:up을 실행하고 http://127.0.0.1:4310을 연다. 접근 키는 .local/credentials.json에 있다. 기존 LogiTrack은 [정지·보존](docs/logitrack-preservation.md) 상태다.

[HTTPS 연결과 CI 게이트 사용법](docs/release-integration.md)을 참고한다. 비교 화면은 같은 데이터셋·정책의 완료 결과를 사용한다.

[프로젝트 CI 키와 승인 기록](docs/ci-operations.md) · [백업·복원 검증](docs/backup-recovery.md)

신규 로컬 백업은 인증 암호화와 복원 보안 카탈로그 검증을 지원한다. 키는 별도 private 디렉터리에 보관한다. 자세한 절차와 운영 제한은 [백업·복원 문서](docs/backup-recovery.md)를 따른다.

관리자는 화면에서 프로젝트를 만들 수 있으며, 작성자는 모의 에이전트와 데이터셋 버전을, 관리자는 릴리스 정책 버전을 등록할 수 있다. 새 프로젝트에 세 가지 버전이 모두 준비되면 평가 실행이 가능하다. 프로젝트 생성은 조직별 최대 100개이며 Idempotency-Key로 중복 요청을 처리한다.

릴리스 검증 기록에 Ed25519 서명을 추가했으며 별도 신뢰 공개키로 오프라인 검증할 수 있다. [서명 운영 문서](docs/receipt-signatures.md)를 따른다.

관리자는 프로젝트 운영 상태에서 대기·실행 중·기한 초과 실행과 최근 워커 신호를 확인할 수 있다. 워커 신호는 현재 처리 성공을 보장하는 판정이 아니며 실행별 증거와 게이트를 함께 확인한다.

실행 기록은 상태·판정 필터와 페이지 조회를 제공한다. 목록 쿼리는 평가 원문을 가져오지 않고 요약만 반환한다. 기준 실행 선택은 기록 필터와 별도로 완료 실행을 제공한다.

정책별 관리자 검토 요구, 불변 승인/반려 기록, 현재 검토 상태를 확인하는 CI 최종 게이트를 지원한다. [관리자 검토](docs/manual-review.md)와 [운영 상태](docs/operations.md) 문서를 따른다.

조직·멤버십·접근 키·세션 테이블도 tenant RLS를 적용한다. 인증 전 조회는 전용 NOLOGIN 역할의 제한된 함수로 수행하며, API DB 역할은 평가를 등록·취소하고 워커가 자동 평가 결과를 확정한다.

백업 지문은 작은 배치로 계산하며 복원된 트리거·제약 조건·열·역할 멤버십과 인증 테넌트 경계까지 검증한다. 기존 백업도 원래 지문 버전으로 복원 검증을 유지한다.

수동 배포 전 읽기 전용 점검: `npm run deploy:preflight`. 준비 조건과 검증 범위는 [GitHub delivery 안내](docs/github-delivery.md#읽기-전용-수동-배포-사전-점검)를 참고한다.

완료된 실행은 관리자 검토 필요 여부와 관계없이 최종 릴리스 게이트를 확인할 수 있다. 확인 시점의 판단과 검증 기록 ID를 표시하며, 실행 재선택·검토 변경·새로고침 시 다시 확인하도록 이전 결과를 무효화한다. 실제 배포 직전에는 CI 게이트를 다시 호출한다.

평가와 최종 게이트의 상태별 다음 행동 안내를 제공한다. 근거 확인·새 평가·관리자 검토·최종 확인·검증 기록으로 이동할 수 있으며, 역할과 승인 만료/반려·결과 유효 시간·확인 실패를 구분한다. 화면 안내는 서버의 판정이나 권한을 변경하지 않는다.
