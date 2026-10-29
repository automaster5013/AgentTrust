# E 드라이브 이전 및 재부팅 검증 — 2026-10-29

이 기록은 기존 Windows 설치에서 실제 수행한 저장소 이전과 자동 기동 검증 결과다. 제품 기능·접근성·시연 영상 검증 결과와는 별개다.

## 최종 저장 구조

| 용도 | 경로 및 연결 |
| --- | --- |
| 프로젝트 | `E:\AgentTrust\AgentTrust.vhdx`의 NTFS `T:\AgentTrust` |
| 기존 경로 호환 | `C:\AgentTrust`는 `T:\AgentTrust`를 가리키는 junction |
| Docker 저장소 | `E:\DockerStorage\DockerStorage.vhdx`의 NTFS R 드라이브 |
| 실제 Docker 데이터 | `R:\DockerData\DockerDesktopWSL\disk\docker_data.vhdx` |
| Docker 오프라인 백업 | `R:\OfflineBackup\docker_data-before-move.vhdx` |

E의 기존 exFAT 자료를 포맷하지 않고 별도 NTFS 가상디스크를 사용했다. Docker Desktop의 공식 Disk image location 이동을 수행했다. 이동 전 Docker를 종료하고 확보한 오프라인 백업은 SHA-256 일치를 검증했으며 보존했다. 이 백업은 같은 물리 E 드라이브에 있으므로 물리 디스크 장애에 대비한 별도 매체 백업을 의미하지 않는다.

C의 이전 프로젝트 원본 백업은 E 보관본의 내용·권한 및 Docker 자산 검증 후 삭제했다. `C:\AgentTrust` junction은 기존 경로 호환을 위해 유지한다. C의 기존 Docker 데이터 VHDX는 공식 이동 완료 후 존재하지 않음을 확인했다. Docker 이동 전후 C 여유 공간은 약 27.99GB에서 116.04GB로 약 88.05GB 증가했다. 최종 재부팅 검증 시점 C 여유 공간은 약 116.55GB였다. 용량은 십진 GB이며 시점에 따라 변한다.

## 실제 검증 결과

| 항목 | 확인 결과 |
| --- | --- |
| R·T 자동 연결 | 실제 Windows 재부팅 후 성공 |
| 기존 컨테이너 | 42개 보존, ID·이미지·볼륨 연결 일치 |
| 볼륨 | 18개 보존, 목록 일치 |
| 이미지 | 전체 목록 일치 |
| AgentTrust | 기존 실행 대상 20개 모두 자동 기동 및 healthy |
| LogiTrack | 정지 상태 유지 |
| 4310 health | HTTP 200 |
| 최종 검사 중 수동 복구 | 없음 |

첫 재부팅에서는 기존 3개만 자동 실행됐고, 나머지 17개는 수동 복구됐다. 조사 결과 3개는 `unless-stopped`, 17개는 `no` 재시작 정책이었다. 기존 실행 대상 20개만 `unless-stopped`로 맞췄다. 보관·초기화 컨테이너와 LogiTrack의 정책은 변경하지 않았다.

정책 보완 후 별도의 실제 Windows 재부팅을 수행했다. 부팅 시각은 **2026-10-29 21:29:06.500 KST**, 읽기 전용 최종 검증 완료는 **21:37:12.356 KST**다. 결과는 `status=pass`, `automaticAgentTrustHealthy=20`, `manualRestorationPerformed=false`였다. 이 두 시각의 차이를 서비스 기동 소요 시간으로 해석하지 않는다. 검사 명령은 저장소 연결이나 컨테이너 시작·중지·수정을 수행하지 않았다.

## 별도 물리 백업 보류 결정 — 2026-10-30

사용자는 별도 물리 저장장치 백업을 보류하고 현 상태를 유지하기로 결정했다. 별도 물리 백업은 생성하지 않았으며 완료로 표시하지 않는다. 이후 명시적인 재개 요청이 있을 때 다시 진행한다.

확인한 물리 구성은 내부 NVMe의 C 드라이브와 외장 Samsung T5의 E 드라이브다. R·T는 E의 VHDX에 연결된 가상 드라이브이며 서로 별도 물리 저장장치가 아니다. E에 보존한 프로젝트와 Docker 데이터 및 기존 오프라인 백업은 그대로 유지한다. R·T 자동 연결, 로그인 후 AgentTrust 20개 자동 기동과 LogiTrack 정지 설정도 유지한다.

E 장치 자체가 고장 나면 원본과 같은 장치의 백업이 함께 영향을 받는 한계가 남는다. GitHub에는 비공개 운영 데이터와 Docker 볼륨이 포함되지 않으므로 GitHub 소스 반영도 전체 운영 백업을 대신하지 않는다. 운영 중 E를 분리하지 않으며, 분리가 필요할 때는 Docker와 저장소를 정상 종료하는 별도 절차를 따른다. 이번 결정 반영에서는 자료 복사·삭제·포맷이나 서비스 정지·재시작을 수행하지 않는다.

## 운영 범위와 근거

- R·T의 기존 SYSTEM 부팅 시 mount 작업은 유지한다. Docker Desktop은 사용자 로그인 시 자동 시작한다. 로그인 전 무인 서비스 실행은 이번 구성의 검증 범위가 아니다.
- `unless-stopped` 정책은 수동 중지 의사를 보존한다. 향후 컨테이너 교체 시에는 배포 설정의 정책과 새 컨테이너 대상 목록을 다시 검토해야 한다.
- 프로젝트 compose·제품 코드는 이번 운영 보완에서 변경하지 않았다. GitHub 문서 반영은 제품 배포나 새 스택 검증을 뜻하지 않는다.
- 원본 근거는 소유자의 비공개 `migration-result.json`, `reboot-result.json`, `autostart-policy-result.json`, `automatic-startup-verification.json`이다. 공개 저장소에는 이 요약만 기록하며 원본 로그·컨테이너 ID·키·프로필·VHDX는 포함하지 않는다.
- 실제 4310 영상·자막·노출 검토는 사용자 추후 제작으로 계속 미완료·보류다.

[자동 기동 설정과 확인 방법](windows-autostart.md)
