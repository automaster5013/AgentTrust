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

`python scripts/stack-oidc-client-contract-smoke.py` inspects the actual local Keycloak client without updating it. The contract requires one exact callback, one exact web origin and logout URI, confidential authorization-code flow, PKCE S256, and disabled implicit/direct password/service-account grants. Eighteen checks include fifteen adverse synthetic HTTPS client settings and a valid synthetic configuration, the actual local client read, and a separate CLI process check of its public fields. Administrative credentials and client secrets remain in memory; the administrator session is closed. This does not validate an external IdP, HTTPS handshake, issuer discovery, production realm policy, or back-channel routing.

Generate an operator-reviewable public client settings fragment without a secret or IdP connection:

```powershell
python scripts/stack-oidc-client-config.py --mode draft --profile https-review --application-origin https://console.example.com --public-issuer https://identity.example.com/realms/agenttrust
```

`--mode check` instead reads a client JSON object from standard input, bounded to 1MiB with strict UTF-8, unique JSON keys and finite JSON values. Supply the same endpoint arguments. Success means the specified client fields match the contract; it does not verify realm issuer configuration, DNS ownership, TLS, authenticated discovery, or an installed production client. No client document or credential is echoed in check output. The draft is a public settings fragment for review, not a realm import or applied configuration. Nineteen process controls verify valid generation/checking and malformed/unsafe input rejection, including missing fields and boolean type confusion.

The original-stack integration job now allows 120 minutes for cold builds, browser regressions and the pinned local model. The former 65-minute budget ended two runs before delivery jobs could execute. All required steps and HIGH/CRITICAL refusal criteria remain mandatory; increasing the time budget does not mark a cancelled run as passed.

`python scripts/stack-identity-scope-readiness.py` separately inspects the actual local scope claim mappers and user-profile permissions without modifying the realm. It requires organization/project UUID attributes to be administrator-editable only, exact OIDC claim mappings, and multivalued application roles. These configuration checks supplement the existing authenticated organization-boundary and signed session-revocation tests; they do not replace token validation or an external IdP acceptance test.

The scope readiness check additionally refuses ambiguous claim collisions, missing/duplicate mappers, disabled token claims, wrong claim names or role types, unmanaged attributes, user-editable scope attributes and missing UUID validation. Negative controls operate on in-memory copies of the local configuration; no identity settings are written.

`python scripts/stack-oidc-discovery-smoke.py` reads the fixed local Keycloak discovery URL with redirects and environment proxies disabled. The response is bounded to 64KiB. Eighteen checks verify the exact issuer and five endpoint fields, authorization-code/PKCE S256/client-secret-basic/RS256 support, and reject altered endpoint or support metadata in memory. This does not authenticate to an IdP or prove external TLS, DNS ownership, signature verification, or a production discovery response.

Client configuration and discovery parsing share the same bounded UTF-8 JSON-object reader. Duplicate keys, nonfinite constants, numeric exponent overflow, non-object roots and oversized input are rejected before contract validation.

HTTPS Console proxy responses require session cookies with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain attribute. Duplicate cookie attributes are refused. A correctly scoped empty session cookie with Max-Age=0 remains valid for logout. Local-review cookie handling remains unchanged. Fifteen isolated actual-image proxy checks include Domain/path/SameSite/duplicate refusals and valid logout expiry forwarding; they exercise synthetic upstream HTTP and do not prove an external HTTPS handshake.

The Java HTTPS profile also refuses a configured cookie Domain, non-root cookie Path, or disabled HttpOnly at configuration time, alongside its existing Secure and SameSite=Lax requirements. Absent path/HttpOnly properties use the standard root-path and HttpOnly defaults. The local-review profile retains its existing settings.

The images job also has a 120-minute bound because it builds/publishes immutable images and then repeats actual evaluation, local-model, backup and recovery checks against those registry images. This budget change is awaiting its own CI validation; no checks are removed or treated as passed merely because more time is available.

### Actual TLS transport controls

`OidcTlsTransportTest` creates a short-lived localhost certificate and TLS server entirely within the Java build fixture. Actual Spring RestClient requests verify that the default trust context rejects the untrusted certificate, a fixture-only trust store accepts the certificate for localhost, and the trusted certificate is still refused for a mismatching IP hostname. Rejected handshakes never reach the fixture HTTP handler. The fixture certificate, server and temporary files are removed; no application trust store, realm, runtime service or operator certificate is changed.

This test exercises [Spring's JDK HTTP request factory](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/client/JdkClientHttpRequestFactory.html) and an actual TLS handshake. It does not demonstrate public DNS, a production certificate chain, an installed external IdP or a completed HTTPS OAuth login.

### Token and user information transport bounds

The authorization-code token client, user information client and JWK retrieval share a bounded Spring request factory backed by the existing OkHttp dependency. Default settings use 3-second connect/write and 10-second socket-read limits and a 10-second whole-call budget through response-body consumption. Request bodies are limited to 32 KiB and expanded response bodies to 64 KiB, including chunked, gzip and error responses. The network response closes before the standard Spring converters receive its bounded bytes. The token client's form/JSON converters and OAuth error handler follow [Spring Security's documented customization contract](https://docs.spring.io/spring-security/reference/servlet/oauth2/client/authorization-grants.html); user information retains the corresponding OAuth error handler. Default certificate and hostname verification remain enabled.

The prior inactivity-only transport accepted a valid response trickled every 25 milliseconds past its one-second read budget and an otherwise valid token response larger than 64 KiB; both were reproduced before this change. New controls require rejection of continuous trickling, stalled bodies and oversized expanded bodies, while an exactly 64 KiB valid response remains usable. They also check request overflow before any provider request, user information response limits, token conversion and invalid_grant handling, and token/UserInfo redirect refusal with zero receiver requests. The budget is per HTTP exchange, not a ten-second end-to-end login SLA; token exchange, JWK retrieval and user information can be separate calls. Local runtime and exact-revision CI acceptance for the new transport are recorded separately. External IdP acceptance remains an operator-specific deployment requirement.

Authorization-code POST bodies are explicitly one-shot. A per-call network attempt fence also refuses status-driven followups, including HTTP503 with Retry-After0, before a second credential-bearing request is transmitted. Disabling connection retries alone did not prevent that status followup in the new adapter's synthetic test; the one-shot body and attempt fence are independently exercised by token and bearer UserInfo controls. Redirects, speculative connection racing and connection retries are disabled. Factory instances share a connection pool rather than accumulating a pool for every decoder instance. [OkHttp's transport implementation](https://github.com/square/okhttp/blob/master/okhttp/src/commonJvmAndroid/kotlin/okhttp3/OkHttpClient.kt) documents the call budget and shared-client behavior.

### Signing-key transport

The identity-token decoder also uses the bounded, non-redirecting transport for its configured JWK endpoint. It permits RS256 and preserves Spring Security's default validators with `OidcIdTokenValidator` and default OIDC claim conversion. OAuth2 login continues to enforce nonce validation in the authentication provider. The factory bean is also used by Spring's authorized-client refresh listener.

Real ephemeral RSA/JWK tests check a valid signature and reject wrong signatures, issuer, audience, expired tokens and key-endpoint redirects. These local tests do not establish production identity-provider availability or TLS readiness. The same per-exchange whole-call and expanded-byte bounds apply to signing-key retrieval; they do not establish total login duration.

TLS 부정 검사 fixture는 실제 HTTPS handshake에서 신뢰되지 않은 인증서와 hostname 불일치를 모두 SSL 원인으로 거부하고, 신뢰한 localhost만 본문을 읽는 조건을 유지한다. 시험 HTTPS 서버는 localhost가 처음 해석한 주소에 연결하며, hostname 불일치도 그 실제 listener 주소를 사용해 IPv4/IPv6 연결 오류가 TLS 거부로 잘못 집계되지 않게 한다. 실제 OIDC factory의 기본 신뢰 검사는 신뢰되지 않은 인증서를 거부한다. 시험용 신뢰 저장소의 성공·hostname 불일치는 별도 JDK 클라이언트에서 검사한다. 외부 TLS와 운영 IdP의 수용 검증은 여전히 남아 있다.
# Authenticated workspace and evaluation-list failures

The Console validates `/backend/me` independently of the recent-evaluation list.
A list service error keeps the verified account and logout control visible, clears
the list, and displays an unavailable state rather than claiming there are no
saved evaluations. `최근 평가 다시 조회` performs an explicit read; it does not
repeat evaluation creation, review or cancellation. A list 401 clears the
protected workspace. Identity and project mismatches remain rejected, and stale
responses cannot repopulate an invalidated workspace.

A local failure-injection check against the preceding image reproduced the
problem: the OIDC callback and identity read succeeded, but an intercepted list
503 prevented the authenticated UI from appearing. Six fresh browser-context
logins without injection passed. This establishes a separate reproducible
failure mode; it does not prove the cause of the earlier isolated login failure.
The browser regression covers list 503, explicit recovery and subsequent 401.

The corrected development Console image passed that regression and the existing
historical-signing-trust browser check with the read-only network guard enabled.
All 130 Console unit tests and TypeScript checking also passed. These checks do
not establish production identity acceptance. The local browser runner initially
failed before navigation because its Python-launched Node process could not find
the installed Chromium executable; the bundled workspace Python runner passed.
The reporter now records a fixed failure category without raw messages, URLs,
cookies, traces or credentials, so launch failures can be distinguished from UI
assertions. The original isolated login assertion remains unexplained.

## Portless synthetic HTTPS identity acceptance

`python scripts/stack-https-identity-smoke.py` prints an offline plan without
contacting Docker or an identity provider. Explicit `--execute` requires both
GitHub CI markers and a nonroot Linux runner. It creates a fresh internal network,
tmpfs PostgreSQL application and identity databases, a separately imported realm,
fresh synthetic users/client secrets, and temporary Core/HTTPS-profile Console
and TLS edge containers. No original database, identity, volume, host trust store
or public port is used. A test-only public CA trust store is injected only into
the temporary Java process; certificate and hostname verification remain enabled.

The protocol client exercises the actual Keycloak authorization-code/PKCE S256
flow through Next.js and Java, authenticated scope and role claims, Secure,
HttpOnly, root-path, host-only SameSite=Lax session cookies, valid-CSRF viewer
refusal, unsolicited-callback refusal, and application/provider logout. Two
seeded records provide positive and foreign-organization read witnesses. They
are explicitly seeded scope witnesses, not Python-completed evaluations. The
TLS edge observes only fixed endpoint counts, never token, cookie, query or
request-body values. Untrusted certificates and a mismatching hostname must
raise actual certificate verification failures before an HTTP handler is reached.

Short-lived fixture certificates and all private inputs are removed after owned
resources stop. Only the bounded `summary.json` is uploaded. Source service
identities and business fingerprints must match before and after the fixture.
This adds protocol-level acceptance; it is not Chromium rendering, an external
enterprise IdP connection, DNS ownership, a production certificate, HA or an SLA.
The initial certificate controls passed locally; complete fixture acceptance is
pending its own exact-revision CI execution and must not be inferred from them.
