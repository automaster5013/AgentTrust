# GitHub CI와 이미지 전달

대상 저장소: https://github.com/automaster5013/AgentTrust . 사용자가 지정한 범위는 소스 업로드, CI, Docker 이미지 빌드·보관과 수동 배포 준비이며 현재 연결할 서버는 없다.

## 자동 검증과 이미지 보관

`.github/workflows/validate.yml`의 Validate and deliver는 main push, PR, 수동 실행을 지원한다. test 작업은 구문·전체 테스트·의존성 audit, Docker 평가와 재시작 지속성, CI 서명, 관리자 승인/반려, 반복 평가, 워커 중단 복구, 백업 인증 실패와 정상 격리 복원을 검증한다. 각 runner의 Compose 프로젝트는 실행 ID로 분리하며 마지막에 해당 서비스를 종료한다. 실제 고객 데이터나 로컬 비밀을 runner에 주입하지 않는다.

main의 검증이 성공하면 image 작업이 같은 commit의 소스를 빌드해 `ghcr.io/automaster5013/agenttrust:sha-<전체 commit SHA>` 및 `:main`에 저장한다. PR과 main 외 수동 실행은 이미지를 발행하지 않는다. 검증 실패 시 발행 작업은 시작하지 않는다. 작업별 contents: read, 발행 작업의 packages: write만 부여하고 내장 GITHUB_TOKEN으로 인증한다. 별도 PAT secret은 필요하지 않다. 출처·commit OCI label을 포함하며 Actions 작업 요약에 digest를 기록한다. tag는 변경될 수 있으므로 배포 시 검증된 `@sha256:<digest>`를 사용한다.

GHCR 패키지 공개 여부를 이 workflow에서 변경하지 않는다. 비공개 이미지 접근이 필요한 운영자는 해당 사용자/조직의 packages:read 권한으로 별도 인증한다. GitHub의 [이미지 발행 지침](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)을 따른다.

## 수동 배포 준비

현재 이미지를 보관하는 delivery 단계이며 실행 중인 서버에 자동 배포하지 않는다. 아래는 준비된 별도 호스트에서 운영자가 명시적으로 수행할 절차다. 기존 로컬 AgentTrust/LogiTrack을 대상으로 실행하지 않는다.

1. 검증이 성공한 commit을 checkout하고 해당 Actions 요약의 이미지 digest를 확보한다. 처음 사용할 호스트는 Docker Compose와 Node 24, 자체 비밀·DB·서명 키를 준비한다. 최초 설정은 `npm ci --ignore-scripts`와 `npm run setup`을 사용한다. 로컬 개발 장치의 `.env`, 접근 키·서명 비밀 키·백업 키를 GitHub에 업로드하지 않는다.
2. 변경 전 암호화 백업과 복원 가능성을 확인한다. 새 버전의 마이그레이션은 소스를 검토한 뒤 `npm run setup`으로 적용한다. setup은 기존 자격증명과 데이터를 보존한다. DB 스키마 변경 후 이전 이미지로의 복귀가 호환된다는 보장은 없으므로 필요한 복원 계획을 먼저 정한다.
3. 비공개 패키지라면 대상 호스트에서 GHCR read 인증을 준비한다. 아래 PowerShell 명령에서 실제 digest를 지정한다.

```powershell
$env:AGENTTRUST_IMAGE = 'ghcr.io/automaster5013/agenttrust@sha256:<Actions 요약의 digest>'
docker compose -f compose.yaml -f compose.image.yaml config --quiet
docker compose -f compose.yaml -f compose.image.yaml pull api worker
docker compose -f compose.yaml -f compose.image.yaml up -d --no-build --wait api worker
Invoke-RestMethod http://127.0.0.1:4310/health
```

Linux 호스트에서 서명 파일이 0600이면 API 사용자 UID:GID를 해당 파일 소유자와 맞춘다. 관리자/root 사용자를 지정하지 않는다. CI는 runner의 비관리자 UID:GID를 AGENTTRUST_API_USER로 지정하며 서명 파일의 0600 권한을 유지한다. Windows 로컬의 기본 node 사용자는 유지한다.

4. 사용자 인증·운영 화면의 워커 신호와 실제 고객의 사전 정의된 평가/릴리스 게이트를 확인한다. 합성 전용 호스트라면 `npm run smoke:sustained -- --cycles 2 --interval-ms 1000`으로 검증한다. 이 smoke는 합성 실행을 저장하므로 고객 DB에 그대로 실행하지 않는다.
5. 이미지 문제를 복귀시킬 때는 직전 검증 digest를 같은 AGENTTRUST_IMAGE 변수로 지정하고 위 pull/up 절차를 수행한다. 볼륨 삭제·Docker 전체 prune·기존 서명 키 덮어쓰기를 하지 않는다. DB 변경은 별도 호환성/복원 판단이 필요하다.

compose.image.yaml은 API의 로컬 build 설정을 제거하고 API와 워커에 같은 이미지를 지정한다. 기존 loopback 포트, 워커 내부 네트워크, read-only 파일시스템, 최소 권한과 API 전용 서명 키를 유지한다. Compose의 [override/reset 규칙](https://docs.docker.com/reference/compose-file/merge/)을 사용한다. 인터넷 공개용 도메인·TLS·역방향 프록시·기업 인증·서버 접속·자동 운영 배포는 별도 목표가 정해진 뒤 구성한다.

## 첫 원격 실행 검증

2026-10-04 [Actions 실행 37166648795](https://github.com/automaster5013/AgentTrust/actions/runs/37166648795), commit `c24a32d42d3d5a9bd53c25adbe0daf212c5efd77`에서 test와 Publish verified container가 모두 성공했다. 136개 테스트가 통과했고 재시작 지속성·서명·관리자 검토·반복 평가·워커 중단 복구·암호화 복원 단계가 모두 통과했다. 최초 검증 이미지 digest는 `ghcr.io/automaster5013/agenttrust@sha256:22de58c068c98bf5bd2f6304b43a0e0b6518d6c23a0b0e416818f6d106203732`다. 이는 해당 commit의 기록이며 최신 이미지는 이후 성공한 Actions 실행의 요약에서 확인한다.

소스와 Git 이력을 업로드하기 전에 로컬 접근 키·DB 비밀번호·서명 비밀 키 포함 여부를 검사했다. `.env`·`.local`·백업/키는 저장소와 이미지에 포함하지 않는다. 이 작업에서 배포 서버에 연결하거나 LogiTrack 자산을 변경하지 않았다.
