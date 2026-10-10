# 새 기술 스택의 로컬 실행

실제 저장소 루트에서 Docker Desktop과 Python 3.12 이상을 사용한다. 기존 `.env`, 4310의 JavaScript 설치, 기존 DB와 정지된 LogiTrack 자산은 보존한다.

```powershell
python scripts/stack-setup.py
python scripts/stack-identity-setup.py
python scripts/stack-gateway-setup.py
python scripts/stack-object-setup.py
docker compose --env-file .local/stack/stack.env --env-file .local/stack/identity.env -f compose.stack.yaml -f compose.stack.identity.yaml -f compose.stack.gateway.yaml -f compose.stack.object.yaml build stack-core-api stack-ai-worker stack-console stack-opa stack-identity stack-gateway stack-object-store stack-db
docker compose --env-file .local/stack/stack.env --env-file .local/stack/identity.env -f compose.stack.yaml -f compose.stack.identity.yaml -f compose.stack.gateway.yaml -f compose.stack.object.yaml up -d --no-build --wait stack-core-api stack-ai-worker stack-console
python scripts/stack-identity-profile.py
python scripts/stack-identity-smoke.py
python scripts/stack-http-smoke.py
python scripts/stack-http-smoke.py --base http://127.0.0.1:4320
python scripts/stack-database-smoke.py
```

Next.js 화면은 `http://127.0.0.1:4320`, Java API는 `http://127.0.0.1:4321`, Keycloak은 `http://127.0.0.1:4322`다. Python 워커·NATS·OPA와 새 PostgreSQL은 호스트 포트를 공개하지 않는다. API는 제한된 DB 역할로 접근하고 Flyway만 별도 마이그레이션 역할을 사용한다. 행 수준 보안이 조직·프로젝트를 제한하며 실행·검토·감사 기록은 API 역할로 수정·삭제할 수 없다.

비공개 `.local/stack/demo-credentials.json`에서 `demo-admin`, `demo-editor`, `demo-viewer`, 다른 조직의 `other-admin` 계정을 확인한다. 파일과 비밀번호를 커밋하거나 공유하지 않는다. 설정 재실행은 기존 생성 값을 유지한다. Linux에서는 비공개 상위 디렉터리와 읽기 전용 파일을 조합해 호스트 접근을 제한하면서 비루트 컨테이너가 Compose secret을 읽게 한다.

Java가 요청자의 범위·역할·멱등성 키를 확인하고 DB에 불변 대기 기록을 저장한다. 설정된 로컬 조직·프로젝트별 디스패처가 미완료 기록을 NATS JetStream에 재전달하고, Python/FastAPI 워커가 영속 소비자로 실행한다. 고정 내부 결과 주소에 인증된 완료를 전달하며 DB 확정 이후에만 ACK한다. Java는 실행·조직·프로젝트·시나리오와 필수 규칙 판정을 대조하고 결과와 감사를 한 번만 추가한다. 요청과 결과를 수정·삭제하지 않는다. 대기 게이트는 차단이며 약 2분의 처리 기한 초과는 `failed/inconclusive`로 확정한다. 늦은 완료·재전달은 확정 결과를 바꾸지 않는다. Next.js가 대기 결과를 갱신하고 로그인·선택 변경 후 늦은 응답은 버린다. 승인 필요 평가는 관리자 승인 이후에만 허용되고 최신 반려가 다시 차단한다.

권장 실행은 Keycloak OIDC Authorization Code와 S256 PKCE를 사용한다. 비공개 파일의 네 합성 계정으로 Keycloak 화면에서 로그인한다. Spring Security가 서명·issuer·audience·nonce·state를 검증한 계정의 조직·프로젝트·역할을 사용한다. 조직 속성은 관리자만 편집하며 직접 비밀번호 grant는 비활성화한다. 애플리케이션 로그아웃과 공급자 확인을 함께 수행하고, 서명된 back-channel 로그아웃은 해당 세션을 무효화한다. 임시 로컬 계정 비교 모드는 기본 Compose에만 남아 있다. 외부 AI 공급자를 호출하지 않는다. 서명 증거와 나머지 기술은 [전환 계획](stack-transition.md)의 별도 완료 조건을 따른다. 새 게이트 조회가 실제 배포를 실행하지 않는다.

Java 21 컨테이너의 Maven 테스트, Python 컨테이너의 pytest, Next.js의 타입 검사·계약 테스트·생산 빌드는 Docker 빌드 중 수행된다. 실제 HTTP 검증은 역할/조직 경계, 필수 실패·근거 누락·오류, 승인 후 반려, 동시 멱등성·검토 순서, 로그아웃 후 재로그인과 프런트 프록시의 외부 Origin 차단을 확인한다. DB 검증은 롤백된 트랜잭션에서 RLS와 수정·삭제 거부를 직접 확인한다. Playwright의 실제 헤드리스 브라우저 검사로 생성·완료·승인·반려, 조회자 권한, 지연된 선택 응답을 검증한다. 화면의 시각 검수는 별개다.

새 GitHub Actions는 합성 로컬 통합 이후 여덟 이미지의 커밋 태그와 불변 digest를 보관한다. 서버 배포는 수행하지 않는다. 게시한 불변 digest를 다시 실행하여 이미지·커밋·언어 런타임과 HTTP/DB 흐름을 대조한 뒤 manifest의 `registryImagesRuntimeVerified`를 기록한다. 워크플로 작성과 원격 실행 성공은 별개이므로 CI 결과를 확인해야 한다.

복구 검증은 아래 명령을 **하나씩** 실행한다. 각 검증은 새 stack-* 의존성만 일시 정지하고 복원하며 자체 세션을 로그아웃한다. 브라우저/HTTP 검증과 같은 서비스의 장애 검증을 동시에 실행하지 않는다.

```powershell
python scripts/stack-recovery-smoke.py --mode worker-restart
python scripts/stack-recovery-smoke.py --mode nats-restart
python scripts/stack-recovery-smoke.py --mode jetstream-persistence
python scripts/stack-recovery-smoke.py --mode core-restart
python scripts/stack-recovery-smoke.py --mode deadline
```

현재 디스패처의 범위는 합성 인증 파일에 등록된 조직·프로젝트다. 동적 기업 조직 등록은 별도 작업이다. JetStream은 디스크에 작업을 보관하고 명시적 ACK와 안정적인 실행 ID로 재전달을 처리한다. 메시지는 최대 10,000개/16MiB, 24시간으로 제한된다. 처리 기한은 공급자 비용 예산 구현을 의미하지 않는다.

현재 릴리스 판정은 인증된 OPA/Rego 호출로 결정한다. Java는 조직·프로젝트·실행과 빌드에 고정된 정책 버전 및 Rego 바이트의 SHA-256을 대조한다. 관리자 승인에는 해당 버전·해시가 저장되며 이전 정책의 승인은 현재 승인 요구를 만족하지 않는다. 과거 반려는 계속 차단한다. 정책 엔진 장애·누락·응답 모순은 배포를 허용하지 않는다. API를 통한 정책 변경과 광범위한 OPA 데이터 조회는 거부하고, 정책 변경은 새 이미지/메타데이터/검증을 따른다.

```powershell
python scripts/stack-policy-metadata.py --check
python scripts/stack-policy-smoke.py
```

정책 검증은 새 DB에 명시적인 합성 이전-policy 승인 fixture를 추가하고 현재 게이트의 거부와 새 관리자 승인 후 허용을 확인한다. 고객 데이터의 정책 이전을 수행한 결과는 아니다. 새 게이트는 여전히 서명되지 않은 현재 조회이며 실제 배포를 실행하지 않는다.

Keycloak은 별도 `agenttrust_stack_identity` DB와 전용 볼륨을 사용한다. `stack-identity-profile.py`는 고정된 합성 realm의 조직 속성과 내부 back-channel 주소를 재검증하고 자체 관리자 세션을 종료한다. `stack-identity-smoke.py`는 실제 암호 grant 거부·잘못된 콜백·서명 없는 로그아웃 거부와 자신이 생성한 공급자 세션 하나의 철회 및 다른 조직 세션 보존을 확인한다. 루프백 HTTP만을 위한 개발 설정이다. 운영 TLS·공개 도메인·기업 프로비저닝·세션 분산 저장과 실제 운영 배포는 아직 검증하지 않았다.

Next.js의 BFF는 WebFlux Gateway를 거쳐 Core API에 연결한다. Gateway는 고정 Core 주소의 허용된 API/OIDC 경로만 전달하고, 인증된 Core 계정의 조직·프로젝트로 Redis의 원자적 요청 한도를 적용한다. 사용자가 보낸 조직·인증 헤더와 기존 설치 쿠키는 전달하지 않는다. 조직·프로젝트당 최초 요청부터 60초 동안 읽기 240회, 쓰기 60회이며 초과는 `429/Retry-After`다. Gateway의 전체 요청 기한은 6초, 입력은 16KiB, 응답은 1MiB다. Redis 장애는 인증된 요청을 `503`으로 거부하며 인증·로그아웃 경로는 한도에서 제외한다. 인증 전 IP 한도와 운영 ingress 방어는 별도 범위다.

Gateway의 진단 주소는 `http://127.0.0.1:4323`이다. Core의 4321은 로컬 직접 비교·검증용으로 남아 있으며 Gateway 한도를 경유하지 않는다. 운영 배포에서는 Core의 외부 공개를 제거하고 Gateway를 유일한 입구로 구성해야 한다. Redis는 호스트 포트 없이 전용 볼륨에 AOF를 보관하고 기본 계정을 비활성화한다. Gateway 계정은 quota 키와 지정 명령만 사용할 수 있다. Redis 8.2의 AOF 복원에는 비활성화된 기본 계정의 제한된 quota 명령 권한도 필요하다. 이 계정의 인증은 계속 거부된다. `appendfsync everysec`는 전원 손실 시 최근 약 1초의 한도 기록 손실 가능성이 있어 엄격한 과금 저장소를 의미하지 않는다.

```powershell
python scripts/stack-gateway-smoke.py
```

Gateway 검증은 한 조직의 quota를 실제 요청으로 소진하고, 같은 조직 공유·다른 조직 독립·AOF 재시작·Redis 장애 거부·만료 후 재개를 확인한다. 멱등성 키를 재사용하므로 쓰기 60회가 60개의 새 실행을 만들지 않는다. 종료 전 창 만료와 자체 로그아웃을 확인한다. 다른 브라우저/HTTP·장애 검사와 동시에 실행하지 않는다.


## MinIO의 버전별 평가 근거

`stack-object-store`는 호스트 포트를 열지 않고 전용 `stack-object-data` 볼륨을 사용한다. `stack-object-init`은 제한 계정, versioning이 활성화된 `stack-evidence` 버킷, 7일 COMPLIANCE 기본 보존과 256MiB 버킷 한도를 구성한다. Core에는 관리자 비밀을 전달하지 않는다. application 계정은 지정 버킷의 근거 쓰기·읽기만 허용하며 객체 나열·삭제·설정 변경은 거부한다. 버킷 목록에서는 권한이 있는 지정 버킷이 발견될 수 있다.

완료된 평가를 조직/프로젝트/실행/SHA-256 경로의 JSON으로 보관하고 실제 바이트를 다시 읽어 확인한 후 버전 ID와 해시를 불변 DB 기록으로 저장한다. `GET /api/runs/{id}/evidence`는 인증된 범위를 먼저 확인한 뒤 기록된 특정 버전을 조회한다. Next.js는 응답의 base64 바이트를 직접 SHA-256으로 대조하고 선택한 평가 결과와 범위가 일치할 때만 검증 결과를 표시한다. 저장소 장애에는 검증된 근거를 반환하지 않는다. 재시작 중 일시적 503은 복구 후 재조회한다.

```powershell
python scripts/stack-object-smoke.py
```

검사는 자체 합성 실행의 잠금·권한·원본 버전·재시작·장애 복구를 확인한다. 자체 객체에 새로운 합성 shadow 버전을 추가하지만 원본 버전과 DB 기록은 유지한다. 이 보관 기능은 현재 OPA 릴리스 게이트의 추가 필수 조건이 아니며, 게이트 조회는 계속 별도로 수행한다. 운영 보존 기간·용량 계획·독립 백업·HA는 미완료다.

MinIO OSS의 고정 공식 보안 릴리스 `RELEASE.2025-10-15T17-29-55Z`를 commit와 다운로드 checksum으로 검증해 소스 빌드한다. 공식 저장소는 archived 상태이므로 운영 유지보수 방안은 별도 결정해야 한다. 이미지에 AGPLv3 라이선스를 포함한다. [공식 소스](https://github.com/minio/minio/tree/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a)와 [객체 잠금 구현](https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/docs/bucket/retention/README.md)을 기준으로 사용한다.


## 같은 프로젝트의 유사 규칙 근거

Python의 `rule-features-v1`은 완료 결과의 규칙 ID·필수 여부·상태·사유 단어를 SHA-256 특징 해싱으로 고정된 64차원 단위 벡터로 만든다. Java는 고정 내부 HTTP 주소에 인증된 요청을 보내고, 기록 범위·원본 결과 해시·버전·차원·정규화·유한값을 확인해 불변 `stack_rule_vectors`에 저장한다. 조직·프로젝트 RLS와 제한 역할은 색인에도 적용한다. 새 PostgreSQL 이미지는 검증한 pgvector 0.8.7 소스를 포함하고 UID 70의 읽기 전용 루트에서 별도 기존 전환 볼륨을 계속 사용한다.

`GET /api/runs/{id}/similar`는 기준 실행을 먼저 조회하고 같은 프로젝트·같은 특징 버전의 벡터를 pgvector 코사인 거리로 정확 정렬해 최대 5개 반환한다. 자기 자신은 제외한다. 준비되지 않은 기준은 409이며 다른 조직은 404다. Next.js는 결과 범위·중복·점수 순서·배포 권한 없음 상태를 확인하고 해당 실행의 상세 근거로 이동한다. 선택 변경에는 이전 검색과 보관 증거를 지운다.

```powershell
python scripts/stack-vector-smoke.py
```

규칙 특징 검색은 학습된 AI 임베딩이나 의미 검색이 아니다. 특징 해싱 충돌이 가능하며 점수는 규칙 검토를 돕는 탐색 값이다. 근거 유사도는 필수 실패·현재 승인·OPA 게이트를 대체하지 않는다. 현재는 작은 합성 데이터의 정확 검색이며 ANN 인덱스·대규모 성능·검색 품질 평가·기업 조직 동적 색인은 미완료다. 내부 HTTP는 본문 포함 2초, DB 쿼리는 각 3초, 연결 대기는 3초로 제한한다. DB 재시작 직후 공급자 세션 로그아웃은 제한된 재시도로 복구를 확인한다.

[공식 pgvector 소스와 거리 연산](https://github.com/pgvector/pgvector/tree/f37c13f68b57d2c3472b2214fbcff699d6d34876)을 따른다.


## Promptfoo로 Python 평가 계약 확인

```powershell
docker compose --env-file .local/stack/stack.env -f compose.stack.yaml -f compose.stack.evaluation.yaml build stack-promptfoo
python scripts/stack-promptfoo-smoke.py
```

Promptfoo는 검증 전용 프로필이며 완료 후 자체 컨테이너를 제거한다. 네 고정 합성 시나리오를 인증된 내부 Python 주소에 한 번씩 요청하고, 8개 단언으로 JSON·엔진·필수 규칙·판정 상태를 독립 확인한다. 공급자 URL과 임의 시나리오는 입력으로 받지 않는다. 요청 기한은 5초, 응답은 8KiB이며 응답의 실행·조직·프로젝트 범위가 일치해야 한다. 로그에는 비밀과 원본 인증 파일을 남기지 않는다. Promptfoo의 텔레메트리·업데이트·공유·캐시·결과 영속화를 비활성화하고 egress 없는 내부 네트워크에서 실행한다.

선택 SDK를 제외한 고정 lockfile로 설치하며 `basic-ftp` 6.2.3 override를 포함한다. `tools/promptfoo`에서 `npm audit --omit=optional --audit-level=high`로 사용 설치 범위를 다시 감사한다. 이는 현재 감사 결과이며 모든 보안 검사 완료를 뜻하지 않는다. 외부 LLM 품질 평가·적대적 입력 캠페인과 Promptfoo 웹 서비스는 별도 범위다.

[Promptfoo 공식 JavaScript 공급자](https://www.promptfoo.dev/docs/providers/custom-api/)와 [Node API](https://www.promptfoo.dev/docs/usage/node-api-reference/)를 따른다.

## 관측 프로필과 보안 검증

[실제 관측 경로와 Grafana 실행](stack-observability.md), [소스·이미지·서명 검증](stack-security.md)을 따른다. 관측 프로필은 기존 데이터와 별도 전용 볼륨을 사용한다. 새 스택을 서비스 재시작 뒤 사용할 때 Gateway는 Core 건강 상태도 확인하며 제한된 GET 읽기만 전송 오류에 한 번 재시도한다. POST 평가/검토와 OAuth 콜백·CSRF 조회는 자동 재전송하지 않는다.
