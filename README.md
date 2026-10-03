# AgentTrust

AI 에이전트의 품질과 보안을 평가하고, 검증 증거를 바탕으로 배포 결정을 지원하는 플랫폼.

현재 단계: v0.8 프로젝트 선택과 CI 승인 중복 처리·유효성 재확인·호출/저장량 제한 구현 완료. 프로젝트 CI 키의 만료·철회, 불변 릴리스 검증 기록과 로컬 백업·격리 복원 검증을 제공한다. 제한된 HTTPS 어댑터와 버전 결과 비교를 제공한다. 외부 연결은 기본 차단한다. DB·인증·조직 격리·독립 워커·감사 기록과 모의 평가를 제공한다. 상용 배포와 실제 고객 모델 연동은 아직 수행하지 않았다.
작업 루트: `C:\AgentTrust`; 독립 Git 저장소의 `main` 브랜치.

## 설계 문서

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
