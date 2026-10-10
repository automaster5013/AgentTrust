# 원래 기술 스택으로의 전환

2026-10-10 사용자 요청으로 원래 제안한 기술 스택을 구현 목표로 복원했다. 기존 v0.187 JavaScript 구현은 기능 계약과 비교 기준이다. 기존 테스트 수·반복 부하 결과를 새 스택의 적용 완료율로 사용하지 않는다.

## 적용 상태와 완료 조건

| 영역 | 목표 기술 | 현재 전환 상태 | 완료 조건 |
|---|---|---|---|
| Frontend | Next.js + TypeScript | 타입/계약/빌드 및 실제 브라우저 평가·승인·조회자·지연 응답 검증. 로컬 Keycloak 로그인 연결 | 실제 인증·평가 요청·결과·검토·현재 게이트 화면, 타입 검사와 기능 검증 |
| Core API | Java 21 + Spring Boot | 실제 Java 21 컨테이너의 HTTP·영속 저장·RLS·동시 멱등성·승인/반려 검증 | 영속 저장·조직/역할·멱등성·평가/검토/게이트의 실제 HTTP 경로 |
| AI Workers | Python + FastAPI | NATS 영속 소비자·인증 완료 콜백·중복 확정 방지·처리 기한 및 로컬 장애 복구 검증. 공급자/비용 예산 확장 필요 | 작업 실행·예산·오류·결과 확정, Java API와 통합 |
| Gateway | Spring WebFlux | Next.js BFF의 실제 요청 경로에 연결. 고정 경로·검증된 조직·크기·기한·CSRF·OAuth 인코딩을 로컬 검증 | 인증된 라우팅·한도·시간 초과·내부 경계 검증 |
| Policy | OPA + Rego | 실제 인증된 OPA 판정·정책 byte hash·승인 버전 결합·장애 시 거부를 로컬 검증. 4개 이미지의 게시·실행 CI 성공 | 필수 실패/누락/승인의 정책 판단과 버전 추적 |
| Database | PostgreSQL + pgvector | 전환 PostgreSQL 별도 DB·제한 역할·RLS·불변 기록 검증. pgvector 0.8.7의 같은 프로젝트 규칙 특징·코사인 검색·워커/DB 재시작 보존을 로컬 검증. 의미 검색은 미구현 | 전환 영속 저장·조직 경계·복구, 벡터 검색의 실제 사용 경로 |
| Cache | Redis | 조직·프로젝트별 원자적 요청 한도·ACL·AOF 재시작·장애 거부·만료 후 재개를 로컬 검증 | 캐시 용도·조직 키·무효화·장애 시 의미 검증 |
| Messaging | NATS JetStream | 별도 디스크 스트림·명시적 ACK·안정 실행 ID·DB 대기 기록 재전달을 실제 로컬 경로에 통합 | 영속 작업 전달·재전달·중복 처리·장애 복구 |
| Object Storage | MinIO | 실제 바이트 해시·기록된 버전 조회·조직 경계·7일 COMPLIANCE 잠금·재시작·장애 복구를 로컬 검증. 7개 게시 이미지 CI 성공 | 조직별 근거 저장·해시·접근 권한·수명 관리 |
| Identity | Keycloak | 별도 DB의 실제 OIDC·S256 PKCE·조직/역할·양쪽 로그아웃·서명된 공급자 세션 철회를 로컬 검증. 운영 설정은 미완료 | OIDC 로그인·조직/역할·토큰·로그아웃 경계 |
| AI Providers | OpenAI + Ollama + OpenAI-compatible | 미착수 | 통제된 공급자별 실제 어댑터·계약·비용/시간 예산 |
| Evaluation | 자체 평가기 + Promptfoo | Python 합성 자체 평가기와 Java 판정 검증 통합. 실제 Promptfoo 0.124.1의 4개 합성 사례·8개 단언 및 내부 비루트 컨테이너를 로컬 검증 | 기존 판정 사례의 새 실행과 Promptfoo 결과 연계 |
| Observability | OpenTelemetry + Prometheus + Tempo + Loki + Grafana | 실제 HTTP 공유 trace·평가 counter·정제된 로그·자동 대시보드·합성 canary 제거 9개 로컬 검증. 원격 CI 재검증 중 | 요청→평가 추적·메트릭·로그·대시보드·민감 정보 제외 |
| Local | Docker Compose | 전환 11개 서비스의 Compose 실행·헬스·워커/메시징/API 재시작·기한 초과 검증 | 별도 서비스/DB로 새 흐름 실행·재시작 보존 |
| Production | Kubernetes + Helm + Terraform | 미착수 | 지정 환경의 렌더/검증·비밀·헬스·배포/복귀. 실제 배포는 별도 결과 |
| CI/CD | GitHub Actions | Java/Python/TypeScript·NATS·브라우저·OPA 통합과 4개 불변 게시 이미지 CI 성공. Keycloak 5개 이미지 확장 CI 성공. Gateway 6개 이미지 확장 CI 성공. MinIO 7개 이미지 확장 CI 성공. pgvector 첫 CI는 DB 중단 검사에서 실패하여 트랜잭션 오류 처리를 보완하고 재검증 중 | Java/Python/TypeScript 검사·통합·이미지 검증 |
| Security | Trivy + Syft + Cosign + Gitleaks + Semgrep | Semgrep/Gitleaks 실제 소스·전체 이력 CI 성공. 여덟 이미지 SBOM/취약점 수정·재검사 및 keyless 서명 CI 구현, 최종 원격 증명 대기 | 각 도구의 실행 결과·검증 가능한 SBOM/서명·실패 게이트 |

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

## 비동기 전환 CI

[1079ed7 NATS 비동기·복구·Playwright 브라우저·게시 이미지 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38034052675)가 성공했다. 이 커밋은 OPA 이전 단계이며 이후 정책 버전 결합은 추가 검증 대상이다.

## OPA 정책 결합 CI와 Keycloak 로컬 검증

[d7f7e65 OPA 정책 버전·승인 결합과 4개 게시 이미지 실행 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38035446396)가 성공했다. 전달 artifact의 archive digest·manifest checksum을 대조했다. 이후 Keycloak OIDC 로그인, 네 합성 계정의 역할·조직 경계, Playwright 3개 흐름, API 재시작, 잘못된 콜백·직접 암호 grant·서명 없는 로그아웃 거부, 생성한 공급자 세션만의 실제 철회를 로컬에서 확인했다. Keycloak 확장 커밋의 원격 CI는 별도 확인한다.

- [Keycloak 최적화 컨테이너](https://www.keycloak.org/server/containers)
- [Spring Security OIDC 로그아웃](https://docs.spring.io/spring-security/reference/servlet/oauth2/login/logout.html)

## Keycloak CI와 Gateway·Redis 로컬 검증

[660e9aa Keycloak 소스·다섯 게시 이미지 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38037235345)가 성공했다. 내려받은 전달 파일의 archive digest와 checksum을 확인했다. WebFlux와 Redis 확장은 경로·인증된 범위·요청 크기·시간 초과 단위 검사와 실제 한도/ACL/장애/재시작/만료 검사 9개를 통과했다. 확장 커밋의 원격 CI는 별도 확인한다.

- [Spring WebFlux WebClient](https://docs.spring.io/spring-framework/reference/web/webflux-webclient.html)
- [Spring Data Redis 원자적 스크립트](https://docs.spring.io/spring-data/redis/reference/redis/scripting.html)
- [Redis AOF 로딩과 ACL 확인 문제](https://github.com/redis/redis/issues/14541)


## Gateway CI와 MinIO 근거 보관 검증

[00c7d49 여섯 게시 이미지의 WebFlux·Redis 실행 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38039155090)가 성공했다. 소스 통합, 정확한 registry 이미지, 실제 Redis 한도와 만료 후 재개를 확인했으며 전달 archive digest와 manifest checksum을 대조했다.

MinIO는 별도 볼륨에 완료된 합성 평가 근거의 바이트와 버전을 저장한다. 제한 계정·DB RLS·브라우저 SHA-256·7일 COMPLIANCE 잠금·관리자 삭제 거부·새 버전 이후 원본 조회·재시작·장애 복구 5개 HTTP 검사와 4개 브라우저 기능 검사를 통과했다. 이는 근거 보관 기능이며 현재 릴리스 게이트의 필수 입력이나 서명된 배포 권한은 아니다. 보관 장애는 근거 조회를 503으로 거부하고 재시도한다. MinIO 확장의 원격 CI 결과는 별도 확인한다.


## MinIO 게시 이미지 CI와 pgvector 로컬 검증

[908ca86 일곱 게시 이미지의 버전별 MinIO 근거 보관 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38040285671)가 성공했다. 실제 저장·바이트 해시·보존 잠금·삭제 거부·새 버전 이후 원본 조회·재시작·장애 복구를 registry 이미지에서 확인했고 전달 archive digest와 manifest checksum을 대조했다.

pgvector 0.8.7은 실제 같은 프로젝트 규칙 특징 코사인 검색, 조회자/다른 조직 경계, 규칙 차이, 워커 중단, DB 재시작과 중단의 거부/복구 검사 5개 및 브라우저 기능 검사 5개를 로컬에서 통과했다. Java 테스트 17개, Python 테스트 6개, TypeScript 계약 검사 11개와 생산 빌드를 수행했다. 새 DB의 비루트·읽기 전용 루트 초기화도 별도 일회성 합성 볼륨에서 확인한 뒤 해당 fixture를 정리했다. pgvector 확장의 원격 결과는 별도 확인한다.


## Promptfoo 독립 평가와 의존성 감사

검증 전용 `tools/promptfoo`는 Promptfoo 0.124.1이 고정된 내부 Python/FastAPI 주소를 직접 호출한다. 네 합성 시나리오의 실제 응답에 대해 JSON·필수 규칙·실패/누락/오류 판정 8개 단언을 통과했다. 비루트·읽기 전용 루트·내부 네트워크·정확한 실행 이미지와 종료 후 자체 컨테이너 제거를 확인했다. AI 품질·외부 공급자·실제 배포 승인 검증을 의미하지 않는다.

초기 의존성 감사의 취약점을 확인한 후 선택 SDK를 설치에서 제외하고 `basic-ftp`를 6.2.3으로 고정했다. 이 설치 범위의 `npm audit --omit=optional`은 0건이며 실제 평가도 다시 통과했다. 예외나 감사 결과 무시는 추가하지 않았다. Promptfoo는 검증 도구이며 상시 서비스/게시된 여덟 애플리케이션 이미지에 포함하지 않는다. 통합 CI의 실제 실행과 별도 감사를 추가한다.

## 관측과 공급망 보안 전환

[관측 경로](stack-observability.md)와 [보안 검사](stack-security.md)에 실제 검증 범위와 남은 조건을 기록했다. Java 21을 유지하며 취약점 수정에 필요한 Spring Boot 4.1.1 전환 후 계약과 재시작 흐름을 재검증했다. 이미지 공급망 서명과 평가 릴리스 게이트의 서명은 별도이며 실제 서버 배포는 수행하지 않는다.
