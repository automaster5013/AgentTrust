# 새 스택의 실제 관측 경로

OpenTelemetry Collector 0.162.0, Prometheus 3.15.0, Tempo 3.1.0, Loki 3.7.8, Grafana 13.2.3을 digest로 고정해 별도 stack-* 서비스와 새 전용 볼륨에 실행한다. Java API/Gateway는 checksum으로 고정한 Java agent 2.32.0, Python은 고정 SDK 1.45.1을 사용한다. 기본 프로필에서는 계측을 활성화하지 않는다.

```powershell
python scripts/stack-observability-setup.py
docker compose --env-file .local/stack/stack.env --env-file .local/stack/identity.env -f compose.stack.yaml -f compose.stack.identity.yaml -f compose.stack.gateway.yaml -f compose.stack.object.yaml -f compose.stack.observability.yaml up -d --no-build --wait stack-core-api stack-ai-worker stack-console stack-otel stack-tempo stack-loki stack-prometheus stack-grafana
python scripts/stack-observability-smoke.py
```

Grafana는 루프백 `http://127.0.0.1:4324`에서 운영자 계정 `admin`으로 접속한다. 생성된 비밀은 비공개 `.local/stack/grafana-password` 파일에서 직접 확인한다. 기업 사용자 Keycloak 로그인과 별도 운영자 경계이며 운영 SSO/다중 테넌트 대시보드는 미구현이다. 세 데이터 소스와 `agenttrust-overview` 대시보드는 파일로 자동 등록된다. 네 패널은 워커 시작 이후 평가 수, 처리율, Java HTTP p95, 정제된 평가 로그다. 누적 평가는 워커 재시작 시 초기화되어 영속 감사 기록을 대체하지 않는다.

HTTP Gateway→Core의 실제 공유 trace ID, Python 평가 counter, Loki의 고정 로그, 데이터 소스 건강 상태와 대시보드 네 패널을 확인한다. NATS 비동기 span 연결은 아직 구현하지 않았다. Collector/Tempo/Loki/Prometheus는 호스트 포트를 열지 않고 내부망에서 연결하며 Docker socket을 사용하지 않는다. 새 관측 볼륨 초기화 컨테이너만 소유권 변경에 필요한 권한을 갖는다.

Collector는 허용 서비스 이름·HTTP method/status만 남기고 URL·헤더·사용자·조직·프로젝트·본문·scope metadata·상태 메시지를 제거한다. 로그 본문은 `application event`로 고정한다. span event는 제거하고 span link가 있는 span 및 exemplar가 있는 metric datapoint는 거부한다. route 제거 후 metric 시리즈를 method/status로 합산한다. health probe의 Java agent를 끄고 Python health 경로도 제외한다.

합성 canary를 resource/scope/schema/URL/header/status/event/link/log/metric metadata에 넣어 실제 Tempo·Loki·Prometheus에서 다시 조회한다. 허용 trace의 canary 제거와 link trace의 저장 거부를 모두 검증한다. 이는 고정된 합성 입력의 검사이며 모든 민감 정보 유출 가능성에 대한 완전한 증명은 아니다. 관측 실패가 배포 승인을 만들지 않으며 관측 데이터는 불변 DB 감사·MinIO 증거와 별도다.

Prometheus와 Loki는 7일 보존을 구성한다. 운영 백업·HA·장애 경보·관측 장애 주입·자원 부하 시험은 미완료다. 9개 실제 로컬 검증이 통과했으며 동일 검사는 새 원격 CI에 포함했다. 원격 통과 여부는 해당 CI 결과를 별도로 확인한다.

- [Collector transform processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/transformprocessor)
- [Loki OTLP](https://grafana.com/docs/loki/latest/send-data/otel/)
- [Tempo 설정](https://grafana.com/docs/tempo/latest/configuration/)
