# 새 기술 스택의 로컬 실행

실제 저장소 루트에서 Docker Desktop과 Python 3.12 이상을 사용한다. 기존 `.env`, 4310의 JavaScript 설치, 기존 DB와 정지된 LogiTrack 자산은 보존한다.

```powershell
python scripts/stack-setup.py
python scripts/stack-identity-setup.py
python scripts/stack-gateway-setup.py
docker compose --env-file .local/stack/stack.env --env-file .local/stack/identity.env -f compose.stack.yaml -f compose.stack.identity.yaml -f compose.stack.gateway.yaml build stack-core-api stack-ai-worker stack-console stack-opa stack-identity stack-gateway
docker compose --env-file .local/stack/stack.env --env-file .local/stack/identity.env -f compose.stack.yaml -f compose.stack.identity.yaml -f compose.stack.gateway.yaml up -d --no-build --wait stack-core-api stack-ai-worker stack-console
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

새 GitHub Actions는 합성 로컬 통합 이후 여섯 이미지의 커밋 태그와 불변 digest를 보관한다. 서버 배포는 수행하지 않는다. 게시한 불변 digest를 다시 실행하여 이미지·커밋·언어 런타임과 HTTP/DB 흐름을 대조한 뒤 manifest의 `registryImagesRuntimeVerified`를 기록한다. 워크플로 작성과 원격 실행 성공은 별개이므로 CI 결과를 확인해야 한다.

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
