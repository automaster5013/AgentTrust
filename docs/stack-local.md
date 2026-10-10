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

Java가 요청자의 범위·역할·멱등성 키를 확인하고 Python/FastAPI에 고정 내부 주소로 합성 평가를 요청한다. 워커 응답의 실행·조직·프로젝트와 필수 규칙 판정을 다시 대조해 결과와 감사를 함께 저장한다. 워커 오류·누락·모순은 `failed/inconclusive`이며 배포를 허용하지 않는다. 승인 필요 평가는 관리자 승인 이후에만 허용되고 최신 반려가 다시 차단한다.

현재 인증은 Spring Security의 로컬 합성 계정이며 Keycloak은 아직 연결되지 않았다. 외부 AI 공급자를 호출하지 않는다. NATS 비동기 처리, OPA 정책, 서명 증거와 나머지 기술은 [전환 계획](stack-transition.md)의 별도 완료 조건을 따른다. 새 게이트 조회가 실제 배포를 실행하지 않는다.

Java 21 컨테이너의 Maven 테스트, Python 컨테이너의 pytest, Next.js의 타입 검사·계약 테스트·생산 빌드는 Docker 빌드 중 수행된다. 실제 HTTP 검증은 역할/조직 경계, 필수 실패·근거 누락·오류, 승인 후 반려, 동시 멱등성·검토 순서, 로그아웃 후 재로그인과 프런트 프록시의 외부 Origin 차단을 확인한다. DB 검증은 롤백된 트랜잭션에서 RLS와 수정·삭제 거부를 직접 확인한다. 브라우저 화면 동작 전체에 대한 시각 검증을 의미하지 않는다.

새 GitHub Actions는 합성 로컬 통합 이후 세 이미지의 커밋 태그와 불변 digest를 보관한다. 서버 배포는 수행하지 않는다. 게시한 불변 digest를 다시 실행하여 이미지·커밋·언어 런타임과 HTTP/DB 흐름을 대조한 뒤 manifest의 `registryImagesRuntimeVerified`를 기록한다. 워크플로 작성과 원격 실행 성공은 별개이므로 CI 결과를 확인해야 한다.
