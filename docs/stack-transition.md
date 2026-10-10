# 원래 기술 스택으로의 전환

2026-10-10 사용자 요청으로 원래 제안한 기술 스택을 구현 목표로 복원했다. 기존 v0.187 JavaScript 구현은 기능 계약과 비교 기준이다. 기존 테스트 수·반복 부하 결과를 새 스택의 적용 완료율로 사용하지 않는다.

## 적용 상태와 완료 조건

| 영역 | 목표 기술 | 현재 전환 상태 | 완료 조건 |
|---|---|---|---|
| Frontend | Next.js + TypeScript | 로컬 합성 흐름 통합·타입/계약/빌드 검증. 화면 기능 검증 확장 필요 | 실제 인증·평가 요청·결과·검토·현재 게이트 화면, 타입 검사와 기능 검증 |
| Core API | Java 21 + Spring Boot | 실제 Java 21 컨테이너의 HTTP·영속 저장·RLS·동시 멱등성·승인/반려 검증 | 영속 저장·조직/역할·멱등성·평가/검토/게이트의 실제 HTTP 경로 |
| AI Workers | Python + FastAPI | NATS 영속 소비자·인증 완료 콜백·중복 확정 방지·처리 기한 및 로컬 장애 복구 검증. 공급자/비용 예산 확장 필요 | 작업 실행·예산·오류·결과 확정, Java API와 통합 |
| Gateway | Spring WebFlux | 미착수 | 인증된 라우팅·한도·시간 초과·내부 경계 검증 |
| Policy | OPA + Rego | 미착수 | 필수 실패/누락/승인의 정책 판단과 버전 추적 |
| Database | PostgreSQL + pgvector | 전환 PostgreSQL 별도 DB·제한 역할·RLS·불변 기록 검증 / pgvector 미착수 | 전환 영속 저장·조직 경계·복구, 벡터 검색의 실제 사용 경로 |
| Cache | Redis | 미착수 | 캐시 용도·조직 키·무효화·장애 시 의미 검증 |
| Messaging | NATS JetStream | 별도 디스크 스트림·명시적 ACK·안정 실행 ID·DB 대기 기록 재전달을 실제 로컬 경로에 통합 | 영속 작업 전달·재전달·중복 처리·장애 복구 |
| Object Storage | MinIO | 미착수 | 조직별 근거 저장·해시·접근 권한·수명 관리 |
| Identity | Keycloak | 미착수 | OIDC 로그인·조직/역할·토큰·로그아웃 경계 |
| AI Providers | OpenAI + Ollama + OpenAI-compatible | 미착수 | 통제된 공급자별 실제 어댑터·계약·비용/시간 예산 |
| Evaluation | 자체 평가기 + Promptfoo | Python 합성 자체 평가기와 Java 판정 검증 통합 / Promptfoo 미착수 | 기존 판정 사례의 새 실행과 Promptfoo 결과 연계 |
| Observability | OpenTelemetry + Prometheus + Tempo + Loki + Grafana | 미착수 | 요청→평가 추적·메트릭·로그·대시보드·민감 정보 제외 |
| Local | Docker Compose | 전환 5개 서비스의 Compose 실행·헬스·워커/메시징/API 재시작·기한 초과 검증 | 별도 서비스/DB로 새 흐름 실행·재시작 보존 |
| Production | Kubernetes + Helm + Terraform | 미착수 | 지정 환경의 렌더/검증·비밀·헬스·배포/복귀. 실제 배포는 별도 결과 |
| CI/CD | GitHub Actions | 첫 Java/Python/TypeScript 통합과 세 불변 게시 이미지 실행 CI 성공. NATS/브라우저 확장 CI 재검증 예정 | Java/Python/TypeScript 검사·통합·이미지 검증 |
| Security | Trivy + Syft + Cosign + Gitleaks + Semgrep | 미착수 | 각 도구의 실행 결과·검증 가능한 SBOM/서명·실패 게이트 |

## 구현 순서

1. Java 21 Spring Boot와 Next.js TypeScript로 인증→평가 요청→저장된 결과 조회→관리자 검토→현재 게이트의 실제 수직 흐름을 완성한다.
2. Python FastAPI 워커와 NATS JetStream으로 비동기 실행을 이전하고 OPA/Rego 정책·Keycloak 인증을 연결한다.
3. MinIO·Redis·pgvector와 공급자·Promptfoo 연계를 각각 실제 사용 기능에 연결한다.
4. WebFlux Gateway·관측성·보안 CI를 통합하고 배포 환경에 맞춘 Kubernetes·Helm·Terraform을 검증한다.

6~8주는 목표안이며 전체 기술의 상용화 완료 약속이 아니다. 첫 수직 흐름의 실측 결과로 일정을 다시 산정한다. 기술 대체·제외는 사용자 합의 없이 진행하지 않는다.

## 보존과 전환 경계

기존 설치는 4310/55432에서 계속 제공하며 기존 DB·환경·SQL·비공개 검증 자료와 정지된 LogiTrack 자산을 보존한다. 새 흐름은 동일 Compose 프로젝트의 stack-* 서비스·전용 DB·전용 볼륨에서 합성 데이터를 사용한다. 전환 DB의 새 마이그레이션은 기존 20개 SQL과 별도이며 기존 고객 데이터 이전은 아직 수행하지 않는다.

임시 로컬 인증을 구현하는 경우 Keycloak 적용 완료로 소개하지 않는다. Java 모의 평가를 구현하는 경우 Python 워커나 실제 AI 공급자 실행으로 소개하지 않는다. 서명 없는 새 게이트를 기존 Ed25519 서명 기록과 동일한 증거로 소개하지 않는다.

## 공식 구현 자료

- [Spring Boot 지원 환경](https://docs.spring.io/spring-boot/system-requirements.html)
- [Next.js 설치와 TypeScript](https://nextjs.org/docs/app/getting-started/installation)
- [Spring Security CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)

- [FastAPI 컨테이너 구현](https://fastapi.tiangolo.com/deployment/docker/)
- [NATS JetStream 전달 의미](https://docs.nats.io/concepts/jetstream)

## 확인된 첫 전환 CI

[7ddb877 소스 통합·불변 게시 이미지 실행 검증](https://github.com/automaster5013/AgentTrust/actions/runs/38033039011)이 성공했다. Java 21/Python/Next.js의 **동기 합성 흐름** 기준이며, 이후 NATS 비동기·브라우저 확장은 해당 커밋의 범위가 아니다. 내려받은 전달 artifact의 archive digest와 manifest checksum도 로컬에서 대조했다. 기존 JavaScript CI 역시 유지한다.
