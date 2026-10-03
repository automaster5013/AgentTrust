# LogiTrack 보존 상태

사용자 결정(2026-10-03)에 따라 프로젝트 라벨 com.docker.compose.project=logitrack인 컨테이너 12개를 정지했다. 컨테이너·이미지·네트워크·볼륨 삭제, prune, Docker Desktop 초기화는 실행하지 않았다. C:\LogiTrack 파일을 수정하지 않았다.

확인한 이름: simulator, web, api, grafana, prometheus, alertmanager, otel-collector, analytics, tempo, redis, kafka, postgres. 모두 logitrack-<service>-1이며 exited 상태다. 이름이 logitrack_으로 시작하는 기존 데이터 볼륨 7개가 그대로 존재한다. LogiTrack 자체 이미지 태그 5개도 조회 가능하다.

복원 관련 제한: otel-collector와 analytics 컨테이너에 기록된 과거 image ID 두 개는 Docker image inspect로 조회되지 않았다. 현재 logitrack-otel-collector:latest와 logitrack-analytics:latest 태그는 존재하지만 과거 ID와 다르다. 이번 작업에서 이미지를 삭제하지 않았으며, 그 과거 이미지의 동일 버전 복원은 아직 검증하지 않았다. 기존 컨테이너와 볼륨은 유지했다.

현재 컨테이너 ID, 이미지 참조, 현재 태그, 볼륨 목록은 Git에서 제외한 C:\AgentTrust\.local\logitrack-preservation.json에 기록했다. 이 목록은 백업 파일이 아니다.

원래 Compose 파일은 컨테이너 라벨 기준 C:\LogiTrack\docker-compose.yml이다. 향후 재개 요청 시 이 파일과 기존 환경 설정을 확인하고 서비스 준비 상태를 검증한다. AgentTrust와 동시에 실행하려면 호스트 포트가 겹치지 않도록 확인한다. 현재 AgentTrust는 4310과 55432만 공개한다.

LogiTrack을 다시 켜거나 삭제하는 작업은 이번에 수행하지 않았다. 그 프로젝트의 volumes 제거 옵션이나 전체 Docker prune을 AgentTrust 정리 용도로 사용하지 않는다.
