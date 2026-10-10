# 새 기술 스택의 로컬 실행

실제 저장소 루트에서 Docker Desktop과 Python 3.12 이상을 사용한다. 기존 `.env`, 4310의 JavaScript 설치, 기존 DB와 정지된 LogiTrack 자산은 보존한다.

```powershell
python scripts/stack-setup.py
docker compose --env-file .local/stack/stack.env -f compose.stack.yaml build stack-core-api stack-ai-worker stack-console
docker compose --env-file .local/stack/stack.env -f compose.stack.yaml up -d --no-build --wait stack-core-api stack-ai-worker stack-console
python scripts/stack-http-smoke.py
python scripts/stack-http-smoke.py --base http://127.0.0.1:4320
python scripts/stack-database-smoke.py
```

Next.js 화면은 `http://127.0.0.1:4320`, Java API는 `http://127.0.0.1:4321`이다. Python 워커와 새 PostgreSQL은 호스트 포트를 공개하지 않는다. API는 제한된 DB 역할로 접근하고 Flyway만 별도 마이그레이션 역할을 사용한다. 행 수준 보안이 조직·프로젝트를 제한하며 실행·검토·감사 기록은 API 역할로 수정·삭제할 수 없다.

비공개 `.local/stack/demo-credentials.json`에서 `demo-admin`, `demo-editor`, `demo-viewer`, 다른 조직의 `other-admin` 계정을 확인한다. 파일과 비밀번호를 커밋하거나 공유하지 않는다. 설정 재실행은 기존 생성 값을 유지한다. Linux에서는 비공개 상위 디렉터리와 읽기 전용 파일을 조합해 호스트 접근을 제한하면서 비루트 컨테이너가 Compose secret을 읽게 한다.

Java가 요청자의 범위·역할·멱등성 키를 확인하고 DB에 불변 대기 기록을 저장한다. 설정된 로컬 조직·프로젝트별 디스패처가 미완료 기록을 NATS JetStream에 재전달하고, Python/FastAPI 워커가 영속 소비자로 실행한다. 고정 내부 결과 주소에 인증된 완료를 전달하며 DB 확정 이후에만 ACK한다. Java는 실행·조직·프로젝트·시나리오와 필수 규칙 판정을 대조하고 결과와 감사를 한 번만 추가한다. 요청과 결과를 수정·삭제하지 않는다. 대기 게이트는 차단이며 약 2분의 처리 기한 초과는 `failed/inconclusive`로 확정한다. 늦은 완료·재전달은 확정 결과를 바꾸지 않는다. Next.js가 대기 결과를 갱신하고 로그인·선택 변경 후 늦은 응답은 버린다. 승인 필요 평가는 관리자 승인 이후에만 허용되고 최신 반려가 다시 차단한다.

현재 인증은 Spring Security의 로컬 합성 계정이며 Keycloak은 아직 연결되지 않았다. 외부 AI 공급자를 호출하지 않는다. OPA 정책, 서명 증거와 나머지 기술은 [전환 계획](stack-transition.md)의 별도 완료 조건을 따른다. 새 게이트 조회가 실제 배포를 실행하지 않는다.

Java 21 컨테이너의 Maven 테스트, Python 컨테이너의 pytest, Next.js의 타입 검사·계약 테스트·생산 빌드는 Docker 빌드 중 수행된다. 실제 HTTP 검증은 역할/조직 경계, 필수 실패·근거 누락·오류, 승인 후 반려, 동시 멱등성·검토 순서, 로그아웃 후 재로그인과 프런트 프록시의 외부 Origin 차단을 확인한다. DB 검증은 롤백된 트랜잭션에서 RLS와 수정·삭제 거부를 직접 확인한다. Playwright의 실제 헤드리스 브라우저 검사로 생성·완료·승인·반려, 조회자 권한, 지연된 선택 응답을 검증한다. 화면의 시각 검수는 별개다.

새 GitHub Actions는 합성 로컬 통합 이후 세 이미지의 커밋 태그와 불변 digest를 보관한다. 서버 배포는 수행하지 않는다. 게시한 불변 digest를 다시 실행하여 이미지·커밋·언어 런타임과 HTTP/DB 흐름을 대조한 뒤 manifest의 `registryImagesRuntimeVerified`를 기록한다. 워크플로 작성과 원격 실행 성공은 별개이므로 CI 결과를 확인해야 한다.

복구 검증은 아래 명령을 **하나씩** 실행한다. 각 검증은 새 stack-* 의존성만 일시 정지하고 복원하며 자체 세션을 로그아웃한다. 브라우저/HTTP 검증과 같은 서비스의 장애 검증을 동시에 실행하지 않는다.

```powershell
python scripts/stack-recovery-smoke.py --mode worker-restart
python scripts/stack-recovery-smoke.py --mode nats-restart
python scripts/stack-recovery-smoke.py --mode jetstream-persistence
python scripts/stack-recovery-smoke.py --mode core-restart
python scripts/stack-recovery-smoke.py --mode deadline
```

현재 디스패처의 범위는 합성 인증 파일에 등록된 조직·프로젝트다. 동적 기업 조직 등록과 Keycloak 연결은 별도 작업이다. JetStream은 디스크에 작업을 보관하고 명시적 ACK와 안정적인 실행 ID로 재전달을 처리한다. 메시지는 최대 10,000개/16MiB, 24시간으로 제한된다. 처리 기한은 공급자 비용 예산 구현을 의미하지 않는다.
