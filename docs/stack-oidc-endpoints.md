# OIDC 주소 설정과 HTTPS 검토 프로필

기존 `local-review`는 Console `http://127.0.0.1:4320`, Keycloak issuer `http://127.0.0.1:4322/realms/agenttrust`와 내부 token/JWK/userinfo 주소를 보존한다. `https-review`는 운영자가 명시한 두 HTTPS 주소로 로그인 콜백·로그인 후 이동·로그아웃·issuer·token/JWK/userinfo를 고정한다. 요청의 Host나 Forwarded 헤더로 콜백 주소를 만들지 않는다.

HTTPS 검토는 공개 DNS의 소문자 정규 주소와 `/realms/agenttrust` issuer만 허용한다. HTTP, IP 주소, 로컬 suffix, 사용자 정보, 포트, 쿼리, fragment, 임의 경로, 인코딩된 호스트·realm을 거부한다. 이것은 DNS의 실제 소유권이나 주소의 공개 IP 여부를 증명하는 검사가 아니다. 네트워크 egress와 신뢰할 IdP는 운영자가 별도로 통제해야 한다.

| Core 설정 | HTTPS 검토 값 |
|---|---|
| `agenttrust.oidc.profile` | `https-review` |
| `agenttrust.oidc.application-origin` | 운영자가 소유한 Console HTTPS origin, 끝 `/` 없음 |
| `agenttrust.oidc.public-issuer` | 운영자가 소유한 Keycloak HTTPS issuer, `/realms/agenttrust` 포함 |
| `server.servlet.session.cookie.secure` | `true` |
| `server.servlet.session.cookie.same-site` | `lax` |

Core는 Secure 쿠키와 Lax 설정 없이 HTTPS 프로필로 시작하지 않는다. Lax는 다른 사이트의 IdP에서 돌아오는 최상위 GET 콜백에 필요하다. POST는 기존 CSRF 검증과 BFF의 정확한 Origin 검증을 유지한다. 기존 64자리 hex client secret 파일은 비공개로 주입하며, 설정 오류에 값이나 비밀을 포함하지 않는다.

Console 이미지는 다음 **비밀이 아닌 빌드 인자**에 동일한 주소를 제공해 만든다. 브라우저와 서버의 주소 계약이 이미지 빌드에 고정된다.

```text
NEXT_PUBLIC_STACK_OIDC_PROFILE=https-review
NEXT_PUBLIC_STACK_APPLICATION_ORIGIN=https://console.example.com
NEXT_PUBLIC_STACK_PUBLIC_ISSUER=https://identity.example.com/realms/agenttrust
```

Console 이미지에는 `dev.agenttrust.oidc.profile`, `dev.agenttrust.oidc.application-origin`, `dev.agenttrust.oidc.public-issuer` 메타데이터와 동일한 읽기 전용 설정 파일을 보관한다. 시작 시 같은 이름의 public 설정을 다른 값으로 덮어쓰면 서버를 시작하지 않는다. `scripts/stack-oidc-image-config.py`는 제공한 주소와 설치된 이미지의 메타데이터를 대조한다. 이 비교 자체는 이미지 서명 검증이 아니므로 신뢰할 정확한 digest와 독립 전달 서명 검증을 먼저 확인해야 한다. `stack-oidc-image-config-test.py`는 실제 HTTPS 후보 이미지의 대조·다른 origin/issuer 거부와 세 설정의 시작 실패 6개를 검사한다.

위 주소는 테스트 예시이며 배포 대상이 아니다. 실제 Keycloak 클라이언트의 redirect URI는 `<Console origin>/backend/login/oauth2/code/keycloak`, post-logout redirect는 `<Console origin>/`로 정확히 등록해야 한다. TLS 인증서 검증을 해제하지 않는다. BFF가 upstream으로부터 받은 세션 쿠키에 Secure·HttpOnly가 없으면 HTTPS 프로필에서 응답을 거부한다. 외부 Host·다른 issuer·다른 redirect 대상·비정상 Origin은 거부한다.

`scripts/stack-oidc-endpoint-proxy-smoke.py`는 HTTPS 설정으로 빌드한 실제 Next.js 이미지와 합성 HTTP upstream을 내부 전용 임시 Docker 네트워크에 연결한다. 공개 포트·비밀·Docker socket을 마운트하지 않으며 9개 경계 검사와 임시 자원 제거·기존 컨테이너 보존을 확인한다. 실제 TLS handshake나 운영 IdP 로그인 검사는 아니다. Java의 실제 Spring authorization resolver는 PKCE S256과 명시한 콜백을 검사한다. 별도로 기존 로컬 Keycloak의 실제 로그인·다운로드·앱/IdP 로그아웃을 확인한다.

이 프로필만으로 운영 배포가 준비되지는 않는다. 실제 TLS/프록시 배치, 기업 IdP 등록·조직 claim 관리, 분산 세션, 키 관리, Helm 운영 프로필과 상태 저장 서비스, 복구·HA와 Grafana 보안 조치는 별도다. 기본 Compose와 현재 검토용 Helm은 로컬 검토 설정을 유지한다. 정확한 커밋의 CI 및 게시 이미지 검증은 별도 기록한다.

The image configuration control script exercises 23 checks: actual HTTPS image intent, two otherwise-valid endpoint mismatches, three runtime-startup mismatches, and seventeen malformed endpoint/profile/image inputs rejected before Docker image inspection. Image metadata comparison does not authenticate image bytes; the delivery signature verifier remains a separate requirement.

`python scripts/stack-oidc-contract-smoke.py` runs the same 25 public endpoint inputs through the actual Java 21 policy, TypeScript policy and Python image preflight policy. The Java/Node containers use pinned images, no network, read-only source mounts and bounded temporary memory. The report distinguishes the 75 policy decisions from authenticated IdP or external TLS checks, which this contract test does not perform.
