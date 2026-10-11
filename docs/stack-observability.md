# 새 스택의 실제 관측 경로

OpenTelemetry Collector 0.162.0은 고정 OCB와 동일 버전의 upstream 구성 요소로 재빌드한다. Tempo 3.1.0과 Loki 3.7.8도 고정 upstream 소스를 재빌드한다. Prometheus 3.15.0도 동일 버전의 고정 소스와 UI를 재빌드한다. Grafana 13.2.3은 공식 digest를 고정하며 별도 stack-* 서비스와 새 전용 볼륨에 실행한다. Java API/Gateway는 checksum으로 고정한 Java agent 2.32.0, Python은 고정 SDK 1.45.1을 사용한다. 기본 프로필에서는 계측을 활성화하지 않는다.

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

## Collector 소스 재빌드 검증

`services/telemetry`는 실제 설정에서 사용하는 receiver, exporter, processor, health extension 8개와 설정 provider 3개를 고정한 Collector 배포다. Go 1.27.2, x/net 0.60.0, gRPC 1.83.2로 빌드하며 OCB 바이너리와 라이선스도 checksum으로 검증한다. 기술이나 기존 수집 경로를 대체하지 않는다. 로컬 실제 이미지의 Syft SBOM 468개 구성 요소와 Trivy HIGH/CRITICAL 0건을 확인했다. 교체 후 관측 9개, 큐 trace 부모 연결 3개, Collector 중단·복구 4개 검사가 통과했다. 생성된 Collector 모듈에는 자체 Go 테스트가 없으므로 이 결과를 단위 테스트 통과로 표현하지 않는다.

Tempo·Loki·Prometheus의 고정 소스 재빌드는 `Pinned observability image rebuild` 수동 CI에서 각각 실행할 수 있다. HIGH/CRITICAL 0건 이후에만 digest 후보를 게시하며, 후보 상태에는 실제 통합·서명·운영 배포 미확인을 명시한다. 해당 후보를 기존 서비스에 적용한 통합 결과는 별도 검증 전까지 완료로 주장하지 않는다. Prometheus 수정 이미지의 후보 검사와 로컬 통합은 아래 결과를 따른다. Grafana의 보안 수정은 남아 있다.

## Tempo와 Loki 수정 이미지

[Tempo 후보 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38101740338)와 [Loki 후보 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38101741680)는 고정 upstream 소스를 Go 1.27.2와 x/net 0.60.0으로 재빌드했다. Syft 구성 요소는 각각 1,343개·1,321개이며 Trivy HIGH/CRITICAL 0건이다. 공식 라이선스와 원래 제품 버전을 유지한다. 후보 artifact archive digest와 보고서 checksum을 확인한 뒤 실제 registry digest를 로컬에 적용했고, 관측 9개·큐 연결 3개·Collector 장애 복구 4개 검사가 통과했다. 새 Compose 소스 빌드와 열세 이미지 전달에 두 서비스를 포함했다. 열세 이미지의 새 CI·서명 전달 결과는 완료 후 별도로 확인한다.

Grafana 공식 플러그인 바이너리의 직접 수정은 기존 plugin 서명을 무효화하므로 서명 검증을 비활성화하지 않는다. 서버와 번들 플러그인의 수정 배포본을 따로 확인해야 한다. Prometheus는 원래 React/Mantine UI와 내장 자산, prometheus·promtool 두 바이너리를 재빌드하며 원래 frontend lockfile을 유지한다.

Tempo·Loki의 distroless 이미지에는 셸이 없으므로 고정 루프백 `/ready`만 확인하는 Go 준비 상태 도구와 exec 형식 healthcheck를 추가했다. redirect를 거부하고 응답 읽기·시간을 제한한다. 실제 서비스의 준비 상태 성공, network none의 연결 실패와 잘못된 component 거부의 6개 실행 검사가 통과했으며 Compose 두 서비스의 Docker 건강 상태와 기존 큐/관측 경로를 다시 확인했다. 추가 도구를 포함한 최종 이미지의 보안·원격 전달 결과는 별도 보고서를 따른다.


## Prometheus 수정 이미지

[Prometheus 후보 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38104130817)는 원래 3.15.0 소스·UI를 checksum으로 고정하고 Go 1.27.2와 x/net 0.60.0으로 두 바이너리를 빌드했다. 444개 SBOM 구성 요소와 HIGH/CRITICAL 0건을 확인했다. 인증된 artifact archive digest·보고서 checksum을 검증한 registry 후보를 로컬에 적용한 뒤 실제 큐 추적 3개·관측 9개·Collector 장애 복구 4개 검사가 통과했다. 준비 상태 healthcheck를 추가한 로컬 이미지도 재검사 0건이다. 공개 Dockerfile과 14개 이미지 전달 경로에 포함했으며, 최종 커밋의 원격 실행·서명 검증은 새 CI 결과를 별도로 확인한다.

Collector 장애 훈련의 복구는 HTTP 준비 상태와 Docker `healthy`를 모두 확인한다. HTTP 응답만 먼저 돌아온 상태를 최종 이미지 건강 상태 검증 완료로 취급하지 않는다.
