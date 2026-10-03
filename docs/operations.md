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
