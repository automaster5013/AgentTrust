# 원래 기술 스택의 평가·릴리스 시연

기업 개발팀이 입력·기대 정답을 고정하고, 실제 로컬 모델의 결과와 사람의 릴리스 승인을 분리해 확인하는 시연이다. 현재 검토 화면은 `http://127.0.0.1:4320`의 Next.js/TypeScript 앱이다. [설치](stack-local.md), [공급자 준비](stack-providers.md), [서명 기록 준비](stack-campaigns.md)를 순서대로 따른다. 설치 전에 디스크 여유를 확인하고 기존 비밀·DB·LogiTrack 자산을 보존한다.

시연 전에 [읽기 전용 점검](stack-review-preflight.md)을 실행하면 로그인·감사 응답과 이미 생성된 캠페인의 보관 근거·현재 정책 조회를 확인할 수 있다. 점검은 평가나 승인을 만들지 않으며 배포 준비 완료를 뜻하지 않는다.

## 1. 조직 계정으로 로그인한다

Keycloak 버튼으로 로그인한다. 합성 계정은 비공개 `.local/stack/demo-credentials.json`에서 직접 확인한다. `demo-admin`은 실행·승인·반려, `demo-editor`는 실행, `demo-viewer`는 조회 권한을 갖는다. 화면의 조직·프로젝트·역할과 API의 실제 권한 검사를 함께 확인한다. 다른 조직의 UUID를 알고 있어도 그 기록에 접근할 수 없어야 한다.

## 2. 입력과 정답을 불변 버전으로 등록한다

‘버전과 평가 캠페인’에서 새 이름을 사용해 에이전트 평가 방식을 ‘참조 정답’으로 선택한다. 공급자는 준비한 로컬 Ollama 또는 로컬 OpenAI 호환 API다. 같은 평가 방식의 데이터셋에 필수 사례 하나를 등록한다.

| 항목 | 시연 값 |
|---|---|
| 사례 식별자 | `answer-green` |
| 입력 | `Respond exactly with {"answer":"GREEN"}.` |
| 기대 정답 | `GREEN` |
| 필수 여부 | 필수 사례 체크 |

입력은 192 UTF-8 바이트, 정답은 128바이트, 사례는 최대 두 개다. 이름·버전·내용·실행 프로필 해시가 저장되며 같은 이름과 버전의 내용을 수정하면 거부된다. 이 표본은 출력 형식과 정확한 정답 비교를 보여주며 모델의 일반적인 정확도를 측정하지 않는다. 기대 정답을 모델 프롬프트에 자동으로 넣지 않는다.

## 3. 평가 통과와 릴리스 승인을 구분한다

고정한 두 버전을 선택하고 관리자 승인 필요를 유지한 채 캠페인을 실행한다. Java API가 admission과 단일 사용 예산을 저장하고 NATS JetStream으로 전달한다. Python 워커가 고정 모델을 실제 호출하며 Python 자체 평가기와 별도 Promptfoo SDK가 응답을 검사한다.

둘 다 정답과 일치하면 평가 `pass`지만 현재 게이트는 관리자 승인 전까지 허용하지 않는다. 사례의 `python-ollama` 또는 `python-openai-compatible` 실행 엔진, `reference-answer` 규칙과 `verifier-agreement` 규칙을 확인한다. 필수 정답 불일치는 `block`, 평가기 불일치·장애·누락은 `inconclusive`다. 오류를 합성 통과로 대체하지 않는다.

관리자가 사유를 입력해 승인하면 현재 OPA 게이트를 다시 확인한다. 같은 캠페인을 반려하면 다시 차단된다. 승인 유효기간은 서버 시각으로 한 시간이며 정책 버전·해시가 달라져도 기존 승인을 재사용하지 않는다. 화면의 게이트는 조회 당시 결과이며 실제 배포 명령을 실행하지 않는다.

## 4. 과거 근거를 독립적으로 검증한다

MinIO의 부모·자식 보관 근거를 확인한다. 브라우저가 기록된 저장 버전과 원본 바이트의 SHA-256을 대조해야 한다. 개발용 서명을 준비했다면 Ed25519 과거 판정 기록과 전체 번들을 내려받을 수 있다. 별도로 신뢰한 공개 키와 기대 조직·프로젝트·캠페인을 지정해 오프라인으로 검증한다.

```powershell
node --experimental-strip-types scripts/stack-verify-campaign-receipt.ts --bundle <내려받은-번들.json> --trusted-public-key <별도로-신뢰한-공개키.pem> --organization <조직-UUID> --project <프로젝트-UUID> --campaign <캠페인-UUID>
```

현재 반려 후에도 과거 승인 시점의 서명과 보관 해시는 그대로 검증될 수 있다. 모든 과거 기록의 `currentDeploymentAuthority`는 `false`다. 이미지 공급망 Cosign 서명, 과거 평가 판정 서명, 현재 OPA 조회를 각각 확인한다.

## 실제 기술 경로와 검증 범위

| 기술 | 이 시연에서 사용하는 경로 |
|---|---|
| Next.js/TypeScript | 로그인·버전 등록·평가·승인·브라우저 해시/서명 검사 |
| Java 21/Spring Boot | 조직 범위·불변 버전·예약·결과 확정·감사·게이트 |
| Python/FastAPI·Promptfoo | 실제 로컬 추론과 두 평가기의 정답 비교 |
| WebFlux·Redis | BFF 요청 전달과 인증된 조직·프로젝트의 원자적 한도 |
| PostgreSQL/pgvector·NATS | 영속 admission·RLS·불변 결과·규칙 이웃 검색·작업 전달 |
| OPA/Rego·MinIO·Keycloak | 정책 판정·버전별 잠금 근거·OIDC/PKCE와 역할 |
| OpenTelemetry·Prometheus·Tempo·Loki·Grafana | 정제된 메트릭·로그·비동기 큐 부모 span과 대시보드 |
| GitHub Actions·보안 도구 | 실제 통합·정확한 게시 이미지·SBOM·취약점·이미지/SBOM 서명 검사 |
| Kubernetes·Helm·Terraform | 앱 구성의 렌더·schema·mock plan 검증; 운영 클러스터 미배포 |

[참조 정답 평가](stack-reference-evaluation.md)의 실제 로컬 검사, [보안](stack-security.md)의 커밋별 CI와 [기능 이전 범위](stack-feature-parity.md)를 근거로 확인한다. 원래 JavaScript 구현의 테스트 수나 GitHub 언어 비율을 새 스택의 완료율로 설명하지 않는다. 유료 OpenAI 호출, 운영 KMS·키 교체, 동적 기업 등록, stateful 운영 배포·HA·운영 복구는 별도 완료 조건이다. Grafana 취약점의 전체 이미지 재검증도 운영 배포 전에 필요하다.

프로젝트의 평가·버전 등록·승인/반려 이력은 화면 아래 **프로젝트 감사 기록**에서 조회한다. 조회자 계정도 같은 범위의 기록을 읽을 수 있다. [감사 조회의 범위와 페이지 경계](stack-audit.md)를 함께 확인한다.


이전 캠페인과 비교 기준은 [캠페인 이력](stack-campaign-history.md)에서 찾는다. 최근 50개 목록 밖의 캠페인도 같은 데이터셋 버전으로 탐색하고 기존 Java 비교 API에서 조건을 다시 확인할 수 있다. [모델 실행 한도](stack-provider-usage.md)는 실제 예약 기록을 보여주며 과금액을 추정하지 않는다.

검증된 원본 번들과 별도로 신뢰한 공개키를 준비했다면 [과거 HTML 보고서](stack-observation-report.md)를 생성해 검토할 수 있다. 이 요약은 자체 서명이나 현재 릴리스 권한을 제공하지 않는다.

평가 실행 전 화면의 **평가 경로 상태 확인**으로 현재 데이터베이스·Python/NATS·OPA 연결을 확인할 수 있습니다. 세 연결이 확인돼도 실제 모델 실행 성공이나 릴리스 승인으로 간주하지 않습니다. [계약과 장애 검증](stack-evaluation-readiness.md)을 참고하세요.

캠페인 준비 화면의 에이전트·데이터셋 **버전 이력 조회**로 최근 50개 밖의 보관 버전을 탐색할 수 있습니다. 선택 전에 실제 불변 내용과 SHA-256을 확인합니다. [이력과 선택 계약](stack-version-history.md)을 참고하세요.
