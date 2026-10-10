# 새 스택의 실제 관측 경로

OpenTelemetry Collector 0.162.0, Prometheus 3.15.0, Tempo 3.1.0, Loki 3.7.8, Grafana 13.2.3을 digest로 고정해 별도 stack-* 서비스와 새 전용 볼륨에 실행한다. Java API/Gateway는 checksum으로 고정한 Java agent 2.32.0, Python은 고정 SDK 1.45.1을 사용한다. 기본 프로필에서는 계측을 활성화하지 않는다.

```powershell
python scripts/stack-observability-setup.py
docker compose --env-file .local/stack/stack.env --env-file .local/stack/identity.env -f compose.stack.yaml -f compose.stack.identity.yaml -f compose.stack.gateway.yaml -f compose.stack.object.yaml -f compose.stack.observability.yaml up -d --no-build --wait stack-core-api stack-ai-worker stack-console stack-otel stack-tempo stack-loki stack-prometheus stack-grafana
python scripts/stack-observability-smoke.py
```

Grafana는 루프백 `http://127.0.0.1:4324`에서 운영자 계정 `admin`으로 접속한다. 생성된 비밀은 비공개 `.local/stack/grafana-password` 파일에서 직접 확인한다. 기업 사용자 Keycloak 로그인과 별도 운영자 경계이며 운영 SSO/다중 테넌트 대시보드는 미구현이다. 세 데이터 소스와 `agenttrust-overview` 대시보드는 파일로 자동 등록된다. 네 패널은 워커 시작 이후 평가 수, 처리율, Java HTTP p95, 정제된 평가 로그다. 누적 평가는 워커 재시작 시 초기화되어 영속 감사 기록을 대체하지 않는다.

HTTP Gateway→Core의 실제 공유 trace ID, Python 평가 counter, Loki의 고정 로그, 데이터 소스 건강 상태와 대시보드 네 패널을 확인한다. NATS 비동기 경로는 별도 Java 발행 span → Python 소비 span → Java 완료 응답 span의 실제 부모·자식 ID까지 확인한다. DB에서 독립적으로 발행하는 작업이므로 최초 admission HTTP 요청과 이어진 trace라고 주장하지 않는다. Collector/Tempo/Loki/Prometheus는 호스트 포트를 열지 않고 내부망에서 연결하며 Docker socket을 사용하지 않는다. 새 관측 볼륨 초기화 컨테이너만 소유권 변경에 필요한 권한을 갖는다.

Collector는 허용 서비스 이름·HTTP method/status만 남기고 URL·헤더·사용자·조직·프로젝트·본문·scope metadata·상태 메시지를 제거한다. 로그 본문은 `application event`로 고정한다. span event는 제거하고 span link가 있는 span 및 exemplar가 있는 metric datapoint는 거부한다. route 제거 후 metric 시리즈를 method/status로 합산한다. health probe의 Java agent를 끄고 Python health 경로도 제외한다.

합성 canary를 resource/scope/schema/URL/header/status/event/link/log/metric metadata에 넣어 실제 Tempo·Loki·Prometheus에서 다시 조회한다. 허용 trace의 canary 제거와 link trace의 저장 거부를 모두 검증한다. 이는 고정된 합성 입력의 검사이며 모든 민감 정보 유출 가능성에 대한 완전한 증명은 아니다. 관측 실패가 배포 승인을 만들지 않으며 관측 데이터는 불변 DB 감사·MinIO 증거와 별도다.

Prometheus와 Loki는 7일 보존을 구성한다. 운영 백업·HA·장애 경보·Collector 외의 관측 서비스 장애 주입·자원 부하 시험은 미완료다. 기존 9개 실제 로컬 검증과 큐 연결 3개 검증이 통과했으며 동일 검사를 새 원격 CI에 포함했다. 원격 통과 여부는 해당 CI 결과를 별도로 확인한다.

`python scripts/stack-queue-trace-smoke.py`는 자신이 만든 합성 평가의 완료와 승인 보류를 확인한 뒤 인증된 Grafana에서 실제 발행·소비·완료 span의 연결을 조회한다. 발행 span의 ID가 소비 span의 부모에, 소비 span의 ID가 완료 응답의 부모에 연결되어야 통과한다. 보관된 trace에 해당 실행·조직·프로젝트·행위자 UUID, event/link나 가변 operation 이름이 있으면 실패한다. readback은 최대 60초 동안 실제 관측 결과를 기다리며 지속적인 오류를 통과로 처리하지 않는다.

큐와 워커 완료 HTTP에는 고정 길이·소문자 hex·0이 아닌 ID를 가진 버전 `00`의 `traceparent`만 전파한다. baggage·tracestate·모델 본문이나 사용자 식별자는 전달하지 않는다. 잘못된 추적 메타데이터는 새 trace로 처리하며 평가 입력 자체를 거부하지 않는다. trace flags는 비트 필드이므로 에이전트가 실제 생성한 `03`도 유지한다. Java의 API/context는 같은 1.67.0 BOM으로 고정하고 기존 Java agent 2.32.0의 SDK를 사용한다. 이 계측은 증거 서명이나 현재 배포 권한을 대신하지 않는다.

- [Collector transform processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/transformprocessor)
- [Loki OTLP](https://grafana.com/docs/loki/latest/send-data/otel/)
- [Tempo 설정](https://grafana.com/docs/tempo/latest/configuration/)
- [W3C Trace Context flags](https://www.w3.org/TR/trace-context-2/#trace-flags)
- [OpenTelemetry Python context propagation](https://opentelemetry.io/docs/languages/python/propagation/)

`python scripts/stack-observability-outage-smoke.py`는 이 프로젝트의 실행 중인 Collector만 확인 후 잠시 중지한다. 실제 통과/필수 차단 평가의 완료, 승인 필요 보류, 필수 실패 승인 거부, 통과 평가의 승인 후 반려, 복구 뒤 동일 거부와 새 큐 trace 연결의 네 검증을 통과했다. 모든 종료 경로에서 Collector와 자체 로그인 세션을 복구한다. 관측 중단은 실제 OPA 권한이나 불변 근거를 대체하지 않으며, 다른 관측 서비스/운영 장애 복구까지 검증한 것은 아니다.
