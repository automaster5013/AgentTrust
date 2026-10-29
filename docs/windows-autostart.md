# Windows 로그인 후 AgentTrust 자동 기동

2026-10-29 적용: 기존 실행 대상 20개 중 17개의 Docker 재시작 정책이 `no`여서 재부팅 후 자동 기동되지 않았다. 기존 3개와 동일하게 20개 모두 `unless-stopped`로 설정했다. 실행 중인 서비스의 정지·재시작이나 컨테이너 재생성은 수행하지 않았다.

대상은 `.local/docker-storage-migration-20261029/preservation-baseline.json`에 저장된 기존 실행 컨테이너 ID 20개다. 보관·초기화용 AgentTrust 컨테이너와 LogiTrack의 정책 및 정지 상태는 변경하지 않았다. 컨테이너 42개, 볼륨 18개, 이미지 목록 보존 및 20개 healthy를 적용 직후 확인했다. 변경 전 정책은 같은 폴더의 `autostart-policy-before.json`에 보존했다.

R/T의 SYSTEM 부팅 시 연결 작업은 유지한다. Docker Desktop의 기존 AutoStart=true 설정에 따라 Windows 사용자 로그인 후 Docker 엔진이 기동되고, 기존 컨테이너가 자동 시작된다. 로그인 이전의 무인 Windows 서비스 운영은 이 구성에 포함되지 않는다. `unless-stopped`는 수동으로 중지한 컨테이너의 중지 의사를 보존한다.

정책 보완 후 실제 재부팅 검증이 통과했다. 2026-10-29 21:29:06.500 KST에 부팅했고, 21:37:12.356 KST에 20개 자동 healthy, HTTP 200, 자산 보존 및 LogiTrack 정지를 확인했다. 수동 복구는 없었다. [저장소 이전 및 재부팅 검증 결과](storage-migration-verification.md)에 전체 범위를 기록했다.

아래 명령은 해당 소유자 설치에만 존재하는 비공개 검증 도구이며 저장소 복제만으로 제공되지 않는다. 재로그인 후 관리자 PowerShell에서 실행한다. 이 명령은 저장소 연결, Docker 실행, 컨테이너 시작·중지·수정을 수행하지 않으며 최대 10분간 정상 기동을 기다린다. 이전 AfterReboot 복구 명령은 수동 복구가 섞이므로 자동 기동 실증에 사용하지 않는다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\AgentTrust\.local\docker-storage-migration-20261029\verify-automatic-startup.ps1"
```

결과: 비공개 `automatic-startup-verification.json`. 최종 결과는 `status=pass`, `automaticAgentTrustHealthy=20`, `manualRestorationPerformed=false`다. 자동 정상 기동 20개, 4310 HTTP 200, 저장 자산 일치, LogiTrack 정지를 확인했다. 오류가 나면 수동 복구를 실행하기 전에 결과를 검토한다.

이번 변경은 현재 컨테이너의 런타임 정책이다. 향후 compose나 배포로 컨테이너를 교체할 때는 해당 배포 설정에도 재시작 정책을 반영하고 새 ID allowlist를 검토해야 한다. 현재 동결된 제품 compose 파일은 변경하지 않았다.

Docker 정책 공식 문서: https://docs.docker.com/engine/containers/start-containers-automatically/
