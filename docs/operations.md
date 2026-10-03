# 로컬 운영 상태 확인

관리자는 선택한 프로젝트의 운영 화면 또는 `GET /v1/operations`에서 대기·실행 중·기한 초과·lease 만료 수, 최근 24시간 완료/실행 오류 수를 조회한다. 실행 집계는 조직·프로젝트로 제한한다. 조회자·작성자·CI 서비스 키는 이 경로를 사용하지 못한다.

독립 워커는 DB 시간으로 2초마다 전역 인프라 heartbeat를 갱신한다. 테넌트 내용이나 자격증명을 저장하지 않는다. 최근 15초 이내 신호는 recent, 오래되거나 미래로 기록된 신호는 stale, 아직 신호가 없으면 missing이다. 이는 최근 DB 연결 신호이며 모든 평가 처리의 성공을 보장하지 않는다. 화면의 값은 마지막 조회 시점이며 새로고침하거나 평가가 종료될 때 다시 읽는다.

신호가 오래됐거나 기한 초과 작업이 보이면 다음 AgentTrust 전용 명령으로 상태를 확인한다.

```powershell
docker compose ps
docker compose logs --tail 50 worker
```

개발 API는 loopback 4310, DB는 loopback 55432를 사용한다. 워커는 외부 포트를 열지 않는다. API와 DB의 공개 포트는 127.0.0.1에만 연결하며 워커는 기본 internal 네트워크에 있다. 로그에 비밀이나 실제 고객 데이터가 없는지 확인하고 외부 공유하지 않는다.

외부 HTTPS opt-in을 활성화하지 않는다. LogiTrack 컨테이너는 정지 상태를 유지하며 이미지·볼륨을 삭제하거나 Docker 전체 prune을 실행하지 않는다. API 기본 health는 DB 연결 검사이며, 워커 상태는 위 heartbeat와 프로젝트 큐를 함께 확인해야 한다.

복구·키 운영 절차는 backup-recovery.md, receipt-signatures.md, ci-operations.md를 따른다. 실제 OIDC·원격 runner·배포 대상은 정해지기 전 연결하지 않는다.

관리자 조직 감사 기록은 선택 프로젝트와 별도로 현재 조직 전체를 조회한다. 평가·승인·반려·CI 확인 등의 동작별 필터와 25개씩 더 보기를 제공한다. `GET /v1/audit-events?limit=25&action=run.review.approved`는 `{items,nextCursor}`를 반환하며 cursor는 조직·선택 프로젝트·동작 필터·감사 리소스에 고정된다. 다른 필터나 워크스페이스에서 재사용하면 400이다. 쿼리 없는 기존 요청은 최신 100개 배열 형식을 유지한다. 조직 관리자는 다른 프로젝트 감사 기록도 볼 수 있으며 조회자·작성자·CI 키는 이 API를 사용할 수 없다. 기록은 감사 동작·시각·리소스 ID만 화면에 표시하며 원문 의견이나 토큰을 기록하지 않는다.

`npm run smoke:resilience`는 AgentTrust 전용 worker 컨테이너를 실제로 정지·재시작하는 합성 장애 검증이다. 기본 프로젝트의 slow 모의 실행을 요청하고, 실행 중 워커 정지 → 배포 차단 유지 → 오래된 heartbeat/만료 lease 표시 → 재시작 후 두 번째 시도 완료 → 완료 감사 1개를 확인한다. 실패 시에도 워커를 시작하고 미완료 합성 실행을 취소한다. `.local/resilience-smoke-<run ID>.json`에 비밀 없는 결과를 저장한다. 로컬 개발 또는 임시 CI 환경의 운영 중단을 허용할 때만 실행하며 실제 고객 워커에 사용하지 않는다. LogiTrack 서비스에 대한 명령은 포함하지 않는다.

검증 workflow는 Ubuntu 임시 runner에서 구문·59개 테스트·의존성 audit 외에 실제 Docker 평가/재시작 지속성, 서명 CI 기록, 관리자 승인/반려, 워커 중단 복구, 암호화 격리 복원을 실행하도록 구성했다. 로컬에서 같은 명령을 검증했다. GitHub 원격 실행은 아직 하지 않았으며 workflow가 존재한다는 이유로 원격 CI 성공이나 실제 배포 완료를 의미하지 않는다. private `.local` 및 `.env`와 백업 키는 CI 아티팩트로 업로드하지 않는다.
