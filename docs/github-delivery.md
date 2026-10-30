# GitHub CI와 이미지 전달

## 2026-10-28 CI/CD 보완

기존 4310 JavaScript 전달 경로는 `test` → 후보 이미지 게시 → 정확한 digest의 레지스트리 실행 검증 → 검증된 이미지의 `main` 태그 승격이다. PR에서는 `test`만 실행하고 게시·승격은 건너뛴다. `main`의 소스 검증과 레지스트리 실행·복원·배포 사전검사가 모두 성공해야 승격하며, 서버 자동 배포는 구성하지 않는다. 소스 반영·이미지 승격·실제 서버 적용은 별개다.

`validate.yml`은 포트폴리오 오프라인 검사에 Python 3.14를 명시하고 setup action도 commit SHA로 고정한다. 별도 `portfolio-tools.yml`은 Ubuntu/Python 3.10·3.14와 Windows/Python 3.14에서 미디어 경계 검사·문서 검사와 Windows PowerShell 구문 검사를 수행한다. 이 경량 검사는 촬영·로그인·FFmpeg 다운로드·Docker·실제 서비스·유료 공급자를 호출하지 않는다. 별도 workflow로 두어 전달 검증기가 확인하는 기존 네 작업의 이름과 개수를 유지한다.

`ae1e4bb`의 [기본 CI](https://github.com/automaster5013/AgentTrust/actions/runs/40665471561)와 [UI 검토 CI](https://github.com/automaster5013/AgentTrust/actions/runs/40665471456)는 성공했다. [새 스택 통합 CI](https://github.com/automaster5013/AgentTrust/actions/runs/40665471462)의 소스 보안 검사는 통과했으며 전체 통합 상태는 해당 실행 결과를 별도로 확인한다. 이는 이후 workflow 보완 커밋의 통과나 `main` 이미지 게시·실제 배포 완료를 뜻하지 않는다.

병합 전에는 정확한 PR head의 실행 결과를 확인한다. 기본 CI와 새 경량 CI, 해당 변경에 적용되는 새 스택 통합·UI CI 결과를 구분하며 과거 성공을 새 리비전에 재사용하지 않는다. 현재 PR은 미병합·실행 제품 미적용 상태이고, 영상·자막·노출 검토는 제출처 규정에 맞춘 추후 제작까지 미완료·보류다.

## Immutable registry-image browser acceptance

The `images` job now runs the complete synthetic browser suite against the
already-running digest-pinned registry images, before enabling the local model.
It then runs the two local-model browser scenarios after the pinned Ollama
provider is ready. Browser dependencies are installed on the disposable runner;
the application images are not rebuilt for these tests. The registry diagnostic
artifact includes the same sanitized browser JSON format as the source job,
without credentials, screenshots, traces or videos.

Acceptance requires both source and registry artifacts for the same revision:
currently 45 synthetic browser tests and two local-model tests in each. A source
pass alone does not establish registry browser acceptance. The workflow change
configures this gate; its first passing execution must still be verified from
authenticated artifacts. Test writes stay in the runner's synthetic fixture,
paid providers remain disabled, and no production server is deployed.

대상 저장소: https://github.com/automaster5013/AgentTrust . 사용자가 지정한 범위는 소스 업로드, CI, Docker 이미지 빌드·보관과 수동 배포 준비이며 현재 연결할 서버는 없다.

## 처음 배포 준비를 확인하는 순서

| 순서 | 준비·작업 | 확인 결과 |
| --- | --- | --- |
| 1 | 성공한 Actions 실행의 commit·digest·시도 번호와 공개 ZIP 확보 | 같은 실행의 네 작업 성공과 원본 checksum |
| 2 | `delivery:verify:bundle`, `delivery:verify:github` | 파일 일치와 원격 CI 성공; 현재 고객 릴리스 승인은 별도 |
| 3 | 별도 대상 호스트의 비밀·DB·마이그레이션·복원 증거 준비, 지정 이미지 pull | 운영자가 검토한 배포 대상과 변경·복귀 계획 |
| 4 | `deploy:preflight` | 읽기 전용 설정·이미지·DB/백업 일치; 포트 가용성·실제 배포 성공은 별도 |
| 5 | 운영자가 이미지 교체 후 인증·워커·정의한 평가·새 최종 게이트 확인 | 대상 호스트에서의 실제 실행 결과 |

현재 배포 서버가 없으므로 아래 절차는 수동 배포 준비다. 이 저장소의 CI 이미지 전달과 고객 에이전트의 릴리스 승인은 별도 흐름이다. 새 호스트 준비 시 로컬 개발 장치의 접근 키·서명 키·백업 키를 그대로 복사해 공개하지 않는다.

| 환경 | Docker와 포트 범위 |
| --- | --- |
| 로컬 개발 | `agenttrust` 프로젝트의 API 4310·DB 55432 loopback 기본값. LogiTrack은 정지·보존 |
| GitHub Actions | 각 작업의 `ubuntu-latest` runner에서 실행별 Compose 프로젝트를 준비. 로컬 Docker Desktop에 연결하는 설정 없음 |
| 수동 배포 대상 | 별도 호스트의 포트·TLS·비밀·복원 준비를 확인한 뒤 운영자가 적용. 현재 연결된 대상 없음 |

기존 로컬 설치의 포트나 DB 연결 설정을 임의로 바꾸지 않는다. 대상 호스트의 실제 포트 충돌 여부는 배포 사전 점검 성공과 별도로 확인한다.

## 자동 검증과 이미지 보관

`.github/workflows/validate.yml`의 Validate and deliver는 main push, PR, 수동 실행을 지원한다. test 작업은 구문·전체 테스트·의존성 audit, Docker 평가와 재시작 지속성, CI 서명, 관리자 승인/반려, 반복 평가, 워커 중단 복구, 백업 인증 실패와 정상 격리 복원을 검증한다. 각 runner의 Compose 프로젝트는 실행 ID로 분리하며 마지막에 해당 서비스를 종료한다. 실제 고객 데이터나 로컬 비밀을 runner에 주입하지 않는다.

v0.144부터 소스 작업과 레지스트리 이미지 실행 작업에서 기본 조직과 기존 두 번째 조직의 짧은 반복 평가를 각각 수행한다. 두 번째 조직에서는 기준 비교·서명 여섯 개와 원래 의견 두 개의 감사 자료·관리자/작성자/조회자/교차 조직 역할 흐름도 검증한다. 각 시연은 로그인 범위와 생성할 실행 수의 용량을 확인하고 자신의 세션을 종료한다. [실제 v0.144 실행](https://github.com/automaster5013/AgentTrust/actions/runs/37325923399)의 두 작업 로그에서 이 흐름의 완료를 대조했다. runner의 합성 실행은 기존 로컬 장시간 검증 집계에 포함하지 않는다.

main의 소스 검증이 성공하면 image 작업이 같은 commit을 빌드해 `ghcr.io/automaster5013/agenttrust:sha-<전체 commit SHA>` 후보로 저장한다. 별도 image-smoke runner가 새 합성 DB·비밀 키를 만들고 후보 digest를 GHCR에서 pull해 로컬 build 없이 실행한다. 실제 컨테이너의 digest·이미지 ID·출처 commit과 비관리자 사용자·loopback 포트·내부 워커 네트워크·읽기 전용 파일시스템·최소 권한·API 전용 서명 키를 확인한다. 평가와 재시작 지속성·서명 게이트·관리자 검토·반복 실행이 통과한 뒤에만 promote 작업이 같은 digest를 `:main`으로 승격한다. 후보 실행 검증 실패 시 기존 main 이미지를 유지한다. PR과 main 외 수동 실행은 이미지를 발행하지 않는다. 검증 실패 시 발행 작업은 시작하지 않는다. 작업별 최소 권한을 사용하며 후보 발행/승격에는 packages: write, 이미지 실행 검증에는 packages: read를 부여하고 내장 GITHUB_TOKEN으로 인증한다. 별도 PAT secret은 필요하지 않다. 출처·commit OCI label을 포함하며 Actions 작업 요약에 digest를 기록한다. tag는 변경될 수 있으므로 배포 시 검증된 `@sha256:<digest>`를 사용한다.

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

## 레지스트리 이미지 실행 검증

`npm run smoke:image`는 AGENTTRUST_IMAGE의 고정 GHCR digest와 AGENTTRUST_EXPECTED_REVISION의 전체 commit SHA를 요구한다. 대상 Compose의 API와 워커만 inspect하며 실제 이미지·revision·출처와 격리 설정을 검증하고 `.local/image-smoke.json`에 비밀 없는 결과를 기록한다. mutable tag, API/워커 이미지 불일치, 출처 revision 오류, 공개 포트, root 실행, 워커의 서명 키, 외부 네트워크/HTTPS 허용 목록 등은 실패한다. 이 명령은 합성·외부 연결 차단 환경의 사전 점검이며 운영 고객 연결을 활성화한 호스트에 그대로 적용하지 않는다.

image-smoke와 promote는 GitHub의 별도 임시 runner에서만 수행한다. 배포 서버와 개발 장치의 Docker Desktop은 변경하지 않는다. 각 작업의 registry 로그인은 종료 시 제거하고 이미지 실행 환경은 성공/실패 모두 종료한다. private DB·키·백업은 runner 밖으로 업로드하지 않는다. 최종 수동 배포용 digest는 Promote runtime-verified main image의 작업 요약에서 확인한다.


## 읽기 전용 수동 배포 사전 점검

`npm run deploy:preflight`는 서비스를 시작·중지하거나 이미지를 내려받거나 데이터베이스를 변경하지 않는다. 배포할 digest와 revision을 명시하고, 해당 이미지를 별도 절차로 미리 내려받은 후 실행한다.

```powershell
$env:AGENTTRUST_IMAGE = 'ghcr.io/automaster5013/agenttrust@sha256:<검증된 64자리 digest>'
$env:AGENTTRUST_EXPECTED_REVISION = '<해당 이미지의 40자리 commit SHA>'
npm run deploy:preflight
```

점검 항목은 Compose의 loopback 포트·서로 다른 포트 번호·worker 내부 네트워크·비특권 실행·읽기 전용 파일 시스템·서명 키 격리, 캐시 이미지의 digest/소스/revision, Ed25519 키 쌍, 암호화 백업 체크섬과 전체 GCM 인증, 같은 백업을 대상으로 한 최근 복원 기록이다. 평문은 메모리에서 폐기하며 파일로 쓰지 않는다. 결과에는 비밀을 포함하지 않고 실패 단계만 출력한다. 성공은 종료 코드 0, 실패는 1이다.

복원 기록은 `.local/recovery-smoke.json`을 사용한다. 기록과 백업 생성 시점은 기본 24시간 이내여야 한다. `AGENTTRUST_BACKUP_MAX_AGE_HOURS`로 0 초과 168 이하의 시간 한도를 지정할 수 있다. 새 증거가 필요하면 별도 작업인 `npm run smoke:recovery`로 백업과 격리 복원 검증을 수행한다. 이 작업은 사전 점검과 달리 백업 파일과 복원 데이터베이스를 생성한다.

성공은 명시된 정적 설정·캐시 이미지·인증된 백업·기존 로컬 복원 기록의 확인이다. 실제 포트 사용 가능 여부, 백업과 무관한 보안 설정의 올바름이나 롤백 호환성, 새 호스트에서의 복원, 원격 보관, CI 승인 출처를 증명하지 않는다. 로컬 JSON 복원 기록은 서명된 증명서가 아니므로 신뢰할 수 있는 운영자가 보관해야 한다. 배포 전에 별도로 확인해야 한다. GitHub의 registry runtime job은 격리 환경에서 새 복원 검증을 수행한 뒤 이 명령까지 통과해야 `main` 이미지 승격을 허용한다.


### 이미지 revision·DB·백업의 마이그레이션 일치

사전 점검은 지정한 `AGENTTRUST_EXPECTED_REVISION`의 마이그레이션 SQL을 로컬 Git 객체에서 읽는다. 해당 commit이 로컬 checkout에 있어야 하며 수정된 작업 트리 SQL을 검증 기준으로 사용하지 않는다. DB의 적용 이력은 `OWNER_DATABASE_URL`에 REPEATABLE READ / READ ONLY 트랜잭션으로 접속해 조회하고 항상 rollback한다. URL은 Compose에 지정된 127.0.0.1 포트·DB 이름·소유자·비밀번호와 일치해야 하며 추가 URL 옵션은 허용하지 않는다. 비밀은 출력하지 않는다.

이미지 revision의 SQL 파일 목록과 DB 적용 목록이 정확히 같고 모든 체크섬이 기존 migrate 명령의 정규화 규칙에 맞아야 통과한다. 누락·추가·중복·변경된 migration은 `database-migration-ledger` 단계에서 차단된다. 이후 인증된 백업의 migration fingerprint도 현재 DB 이력과 같아야 한다. 마이그레이션 적용 후 이전 백업을 계속 사용하는 경우 새 백업과 격리 복원 검증을 별도로 준비해야 한다. 명령은 마이그레이션을 적용하거나 복원하지 않는다.

성공 JSON의 `migrationLedgerVerified`, `migrationCount`, `migrationHash`, `backupMigrationLedgerVerified`는 이 세 이력의 일치만 나타낸다. 마이그레이션 이력의 일치만으로는 수동 DDL의 안전성, 실행 중 변경, 이미지 애플리케이션의 모든 DB 동작, 이전 버전 롤백 안전성이 증명되지 않는다. 아래 보안 카탈로그 비교로 백업과의 일부 구조 차이를 추가 확인한다. 운영자는 배포 시점의 변경 통제와 실제 기능 검증을 별도로 수행한다.


### 검증된 백업과 현재 DB 보안 카탈로그 비교

사전 점검은 마이그레이션 이력과 같은 READ ONLY / REPEATABLE READ 트랜잭션에서 기존 백업 복원 검증의 securityVersion 2 지문을 계산한다. AgentTrust 테이블·시퀀스의 소유자/권한과 RLS 설정, 조직 격리 정책, 함수 정의·권한·설정, 애플리케이션 역할 속성·멤버십, 트리거, 제약조건, 컬럼, 스키마 소유자/권한을 비교 대상으로 삼는다. 원문 카탈로그와 함수 내용은 결과에 출력하지 않는다.

현재 지문이 GCM 인증을 통과한 백업 메타데이터의 `securityHash`와 다르면 `backup-and-prior-restore` 단계에서 차단한다. 성공은 `backupSecurityCatalogVerified: true`, `securityCatalogVersion: 2`로 표시한다. 변경을 자동 복구하거나 새 백업을 만들어 차이를 무시하지 않는다. 차이가 있으면 원인을 확인한 뒤 승인된 변경인지 판단하고, 필요한 경우 별도 백업·격리 복원 검증을 수행한다.

이 검사는 검증된 백업과의 일치를 확인하며 보안 설정 자체의 완전한 감사를 대체하지 않는다. 백업 생성 전에 이미 존재한 문제, 검사 후 변경, 지문에 포함되지 않는 객체·인덱스·DB 설정과 외부 인증, 역할의 실제 비밀번호, 운영 데이터 최신성, 원격 복원, 롤백 안전성은 보증하지 않는다. 백업과 복원 보고서는 신뢰할 수 있는 운영자가 관리해야 한다.


### Deployment isolation override checks (2026-10-28)

The shared deployment/rollback preflight now rejects API/worker overrides that reintroduce host privileges alongside read-only filesystems and dropped capabilities: privileged mode, added capabilities/devices/device-cgroup rules, inherited volumes, automatic Docker API socket access, network mode overrides, non-private namespace modes, and unconfined seccomp/AppArmor options. It accepts omitted settings or explicit safe values without changing its input.

This is a reviewed source change, unapplied to the running product. Rendered Compose validation does not verify live container isolation, full production security, deployment, rollback execution or operational acceptance.

### 실패 진단과 자동화 출력

사전 점검은 성공·실패 모두 표준 출력에 JSON 보고서를 출력한다. 기존 성공 필드는 유지하며 `schemaVersion: 1`, `status: passed|blocked`, 검사별 `checks`를 추가한다. 실패는 종료 코드 1과 `failedCheck`, 고정된 `code`, 비밀 없는 `guidance`를 반환한다. 실패 전 완료 단계만 `passed`, 실패 단계는 `blocked`, 이후 수행하지 않은 단계는 `not_run`이다. 부분 통과를 배포 허용으로 취급하지 않는다. 성공은 종료 코드 0이며 모든 단계가 `passed`다.

| 검사 | 실패 코드 |
| --- | --- |
| 입력 digest·revision·백업 시간 한도 | `PREFLIGHT_INPUTS` |
| Compose 설정 해석 | `PREFLIGHT_COMPOSE` |
| 캐시 이미지와 격리 설정 | `PREFLIGHT_IMAGE` |
| 서명 키 쌍 | `PREFLIGHT_SIGNING` |
| 대상 DB 연결 설정 | `PREFLIGHT_DATABASE_TARGET` |
| DB 읽기 전용 상태·Git revision·마이그레이션 이력 | `PREFLIGHT_DATABASE_STATE` |
| 백업 인증·복원 기록·DB 이력 및 보안 지문 일치 | `PREFLIGHT_RECOVERY` |

정확한 예외·assertion 내용, Docker stderr, DB 접속 문자열, 비밀번호, 키와 원문 카탈로그를 출력하지 않는다. 코드별 안내는 점검할 범위를 설명하며 세부 실패 원인을 추측하거나 자동 수정하지 않는다. 특히 복원 증거 실패는 원인을 조사한 후 필요한 별도 작업을 선택한다.

기계적으로 JSON을 읽을 때는 npm의 안내 출력을 피하고 Node 명령을 직접 사용한다. 아래는 메모리에만 결과를 보관하는 PowerShell 예시다. 이미지/revision 환경 변수와 필요한 준비 조건은 위 절차와 같다.

```powershell
$json = & node --env-file-if-exists=.env scripts/deploy-preflight.mjs
$preflightExitCode = $LASTEXITCODE
$report = $json | ConvertFrom-Json
if ($preflightExitCode -ne 0 -or $report.status -ne 'passed') {
    throw ('Preflight blocked: ' + $report.code)
}
```

검사 실패 시 stderr에는 고정 코드만 별도로 표시한다. 보고서를 저장하거나 수집하는 운영 자동화도 종료 코드와 `status`를 함께 확인해야 한다. 이 보고서는 서명된 배포 승인 증명이 아니며, 점검의 기존 범위와 제한은 그대로 적용된다.


### 실행별 공개 배포 명세

registry runtime job은 실제 이미지 검사와 모든 사전 점검이 성공한 뒤 공개 가능한 JSON 명세를 Actions 작업 요약에 남긴다. 명세에는 저장소, commit SHA, 고정 이미지 digest, workflow 실행 ID·시도 번호·URL, 검증 시각과 통과 검사 ID만 포함한다. 백업 이름·DB 접속 정보·키·원문 카탈로그·전체 private 보고서는 포함하지 않는다.

`runtime_verified`는 후보 실행 검증 완료 상태다. 승격 작업은 같은 실행·시도·revision·digest의 명세인지 먼저 확인하고, Docker push 성공 후 별도 작업 요약에 `state: promoted`, `promotedAt`을 기록한다. 이 최종 요약에서 JSON을 복사해 수동 배포 기록으로 보관할 수 있다. `serverDeployed: false`는 실제 서버 배포를 수행하지 않았음을 나타낸다. 요약은 해당 Actions 실행에 연결된다. 이후 아래의 다운로드 artifact를 추가했으며 GitHub release는 만들지 않는다.

이 명세는 workflow가 만든 운영 기록이며 서명된 attestation이나 고객 릴리스 승인 영수증이 아니다. JSON만으로 CI의 출처·성공을 증명하지 않으므로 GitHub의 해당 실행 전체 성공 상태와 명세를 함께 확인한다. 실패·재실행 시도·다른 digest의 기록을 섞지 않는다. GitHub 실행/로그 보존 정책에 따라 나중에 요약을 사용할 수 없을 수 있으므로 장기 보관은 별도 운영 정책으로 관리한다.


### 수동 배포 명세 확인 명령

`npm run delivery:verify -- <manifest.json>`은 승격 작업 요약에서 저장한 공개 명세를 읽기 전용으로 확인한다. Docker·DB·GitHub에 접속하지 않으며 파일을 수정하지 않는다. 이미지·revision·저장소·실행 ID·시도 번호를 명세와 별도로, 신뢰할 수 있는 GitHub 성공 실행에서 먼저 확인해 지정한다. 명세 자체에서 기대값을 자동 추출하지 않는다.

```powershell
$env:AGENTTRUST_DELIVERY_REPOSITORY = 'automaster5013/AgentTrust'
$env:AGENTTRUST_IMAGE = 'ghcr.io/automaster5013/agenttrust@sha256:<검증된 digest>'
$env:AGENTTRUST_EXPECTED_REVISION = '<검증된 commit SHA>'
$env:AGENTTRUST_DELIVERY_RUN_ID = '<검증된 Actions 실행 ID>'
$env:AGENTTRUST_DELIVERY_RUN_ATTEMPT = '<해당 시도 번호>'
npm run delivery:verify -- .local/delivery-manifest.json
```

명령은 `promoted` 상태, schemaVersion 1, 저장소·commit·digest·실행·시도·URL 일치, 전체 검증 목록과 시각 순서, 미래가 아닌 승격 시각을 확인한다. 후보 상태, 누락/변경된 검사, 잘못된 JSON/UTF-8, 64 KiB 초과 파일은 종료 코드 1과 `DELIVERY_MANIFEST_INVALID` JSON으로 차단한다. 경로·원문·예외를 출력하지 않고 알 수 없는 입력 필드도 결과에서 제외한다. 정상 결과는 종료 코드 0과 `status: passed`, `identityAndStructureVerified: true`다.

정상 결과에도 `ciSuccessChecked: false`, `signatureVerified: false`를 명시한다. 파일 검사는 GitHub 성공 상태 조회나 서명된 출처 확인이 아니며, 조작자가 모든 필드를 재작성하면 파일 검사만으로 이를 판별할 수 없다. 신뢰할 수 있는 GitHub 실행 전체 성공 여부를 별도로 확인하고, 기존 `deploy:preflight`로 호스트 상태도 점검한다. 명세 검사를 배포 승인이나 자동 배포로 취급하지 않는다. 오래된 정상 명세의 열람은 허용하며 최신 릴리스 선택은 운영자가 결정한다.

기계적으로 결과를 읽을 때는 `node scripts/verify-delivery.mjs <manifest.json>`을 직접 사용해 npm 안내 출력 없이 JSON을 얻는다. 이 명령은 `.env`를 자동으로 읽지 않으며 위의 독립적인 기대값만 필요하다. CI 승격 작업도 최종 명세 파일을 같은 명령으로 읽어 일치를 확인한다.


### GitHub 성공 결과의 온라인 확인

`npm run delivery:verify:github -- <manifest.json>`은 기존 파일 검사 후 GitHub의 [실행 시도 조회 API](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt)와 [해당 시도의 작업 조회 API](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt)를 읽기 전용으로 조회한다. 기대값 환경 변수와 명세 파일은 위 `delivery:verify`와 같다. 공개 저장소는 인증 없이 사용할 수 있다. 비공개 저장소나 인증이 필요한 경우 Actions read 권한의 `AGENTTRUST_GITHUB_TOKEN`을 호출 환경에서 별도로 제공한다. 토큰을 명령 인자·파일·로그에 기록하지 않으며 이 명령은 자격증명 저장소를 자동 조회하지 않는다.

```powershell
npm run delivery:verify:github -- .local/delivery-manifest.json
```

검사 대상은 지정한 저장소와 실행·시도 번호의 commit, main 브랜치, push/workflow_dispatch 이벤트, `.github/workflows/validate.yml`, 성공 완료 상태다. 같은 시도의 `test`, `Publish candidate container`, `Verify registry image runtime`, `Promote runtime-verified main image` 네 작업이 모두 같은 commit으로 성공해야 한다. 누락·중복·추가 작업, 실패·건너뜀·대기 상태, 다른 시도 결과는 차단한다. 향후 workflow 작업 이름/구조를 변경하면 이 검증 계약도 함께 갱신해야 한다.

요청은 `api.github.com`의 고정 HTTPS 경로로만 GET하며 redirect를 따르지 않는다. 응답은 각 1 MiB와 15초로 제한하고 API 접근 거절·rate limit·네트워크 오류·잘못된 응답을 종료 코드 1과 `DELIVERY_GITHUB_UNVERIFIED`로 처리한다. 오류 응답·예외·토큰은 출력하지 않으며 오프라인 성공으로 대체하지 않는다. 정상 결과는 종료 코드 0, `ciSuccessChecked: true`, `ciJobsVerified: 4`, 조회 시각 `ciCheckedAt`을 포함한다. 기계적으로 읽을 때는 `node scripts/verify-delivery-github.mjs <manifest.json>`을 직접 사용한다.

온라인 확인은 GitHub가 해당 실행 시도의 성공을 보고했음을 확인한다. API 작업 결과만으로 명세 digest가 실제 registry push와 결합됐다는 암호학적 증명이 생기지 않으므로 `registryDigestBindingChecked: false`, `signatureVerified: false`를 명시한다. 검증 digest는 신뢰할 수 있는 성공 실행 요약과 별도로 확인해야 한다. 호스트 사전 점검·고객 릴리스 승인·실제 배포도 별도 절차다. 현재 CI 안에서 자신의 최종 성공을 조회하면 아직 실행 중이므로 통과할 수 없다. 이 온라인 명령은 workflow 전체 완료 후 운영자가 실행한다.


### 다운로드 가능한 공개 명세 묶음

승격 후 명세 파일 검사가 통과하면 공개 필드만 다시 투영한 `delivery-manifest.json`과 그 파일의 정확한 UTF-8 바이트에 대한 `delivery-manifest.sha256`을 [Actions artifact](https://github.com/actions/upload-artifact)로 저장한다. artifact 이름은 `agenttrust-delivery-<commit>-<run ID>-<attempt>`이며, 요청한 보관 기간은 30일이다. 승격 작업 요약의 다운로드 링크나 해당 실행의 Artifacts 목록에서 ZIP을 받을 수 있다. GitHub 로그인과 저장소 접근 권한이 필요할 수 있으며 저장소 보관 정책이나 삭제에 따라 다운로드 가능 기간이 제한될 수 있다.

업로드 action은 commit SHA로 고정했다. 대상은 두 파일의 정확한 경로뿐이며 wildcard·전체 작업 디렉터리·`.local`·`.env`·백업·키·원문 private 보고서를 업로드하지 않는다. 공개 출력 폴더 `delivery-artifacts/`도 Git과 Docker context에서 제외한다. 기존 출력 폴더를 덮어쓰지 않으며 파일 준비나 업로드 실패는 workflow 실패로 처리한다. 이미지 승격 이후 artifact 업로드가 실패할 수 있으므로 전체 실행 성공 여부를 확인해야 한다.

ZIP을 새 폴더에 풀고, Linux에서는 `sha256sum -c delivery-manifest.sha256`, PowerShell에서는 아래처럼 체크섬을 확인한다. 파일의 줄바꿈·인코딩을 다시 저장하지 말고 다운로드한 원본을 사용한다.

```powershell
$expected = ((Get-Content delivery-manifest.sha256 -Raw).Trim() -split '  ')[0]
$actual = (Get-FileHash delivery-manifest.json -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Delivery manifest checksum mismatch' }
```

다음으로 독립적인 기대값을 설정하고 `delivery:verify` 및 `delivery:verify:github`를 실행한다. checksum은 다운로드/복사 중 변경 감지용이며, JSON과 checksum을 함께 조작한 경우를 인증하지 않는다. 서명된 attestation·CI 출처 인증·고객 릴리스 승인·호스트 점검·실제 배포를 대체하지 않는다. 장기 보관이 필요하면 운영자가 승인된 별도 보관 정책을 적용한다.


### 묶음의 파일 무결성과 명세 일치 검사

다운로드한 ZIP을 새 전용 폴더에 풀고 `npm run delivery:verify:bundle -- <폴더>`를 실행한다. 기대값 환경 변수는 `delivery:verify`와 동일하며 명세에서 자동 추출하지 않는다. 폴더에는 `delivery-manifest.json`과 `delivery-manifest.sha256` 두 일반 파일만 있어야 한다. 추가 파일·디렉터리·심볼릭 링크, 다른 파일명을 가리키는 checksum, 과도한 파일 크기, 바이트 변경과 명세 불일치는 차단한다. JSON 64 KiB, checksum 128바이트로 제한한다. checksum 파일의 LF/CRLF는 허용하지만 JSON은 원래 바이트 그대로 해시한다.

성공은 종료 코드 0, `status: passed`, `manifestChecksumVerified: true`와 `manifestSha256`을 반환한다. 실패는 종료 코드 1과 `DELIVERY_BUNDLE_INVALID` JSON을 반환하며 경로·원문·예외를 노출하지 않는다. 이 명령은 파일을 변경하거나 Docker·DB·GitHub에 접속하지 않는다. JSON과 checksum을 함께 조작한 경우의 인증은 아니며, 정상 결과에도 `ciSuccessChecked: false`, `signatureVerified: false`를 유지한다. 다음으로 `delivery:verify:github`와 호스트 사전 점검을 별도로 수행한다. CI는 공개 묶음을 업로드하기 전에 같은 명령을 실행한다. JSON 자동화 출력은 `node scripts/verify-delivery-bundle.mjs <폴더>`로 얻는다.

## 실제 전달 묶음 내려받기와 로컬 사전 점검 기록 — v0.79

[검증된 v0.79 실행](https://github.com/automaster5013/AgentTrust/actions/runs/37201321361)의 실제 artifact ZIP을 로컬로 내려받았다. ZIP SHA-256은 GitHub artifact metadata의 digest와 일치했고, 내부 두 파일의 manifest checksum은 CI에서 확인한 값과 일치했다. 선택한 image/revision/repository/run ID를 별도로 지정해 `delivery:verify:bundle`도 통과했다. API 인증 헤더는 artifact 저장소 리디렉션에 전달하지 않았으며 내려받기·추출 크기와 파일 이름을 제한했다. 상세 파일은 private .local에 보관한다.

같은 검증 image digest를 pull해 캐시하고 `deploy:preflight`를 읽기 전용으로 실행했다. 이미지 revision/source·non-root 사용자와 Compose 설정, 기존 서명 키 쌍, 정확한 소스 revision의 DB 마이그레이션 목록, 인증된 백업의 마이그레이션/보안 카탈로그와 이전 격리 복원 증거를 확인했다. 사전 점검에는 현재 포트 가용성·검사 이후 변경·별도 스테이징·운영 배포가 포함되지 않는다. 레지스트리 이미지를 새 서버에 기동하거나 운영 DB를 마이그레이션하지 않았다. 이 기록은 해당 v0.79의 근거이며 이후 main 변경에는 새 전달 검증이 필요하다.

## 검증 이미지의 기존 로컬 설치 실행 — v0.91

[소스 76d7a3c](https://github.com/automaster5013/AgentTrust/commit/76d7a3cb872c6cf7201d93a32b6d16f853e8a5b1)와 [CI #37206618620](https://github.com/automaster5013/AgentTrust/actions/runs/37206618620)의 네 작업 성공 및 최종 승격 로그를 확인했다. 전달 대상은 `ghcr.io/automaster5013/agenttrust@sha256:874382518262addaad095321f76945c7abc0865143267e38ceba8a09838fff40`이다. 실제 artifact ZIP의 digest와 두 파일의 checksum을 비교하고 독립적인 기대값으로 명세·온라인 CI 검사를 통과했다. checksum과 CI 성공 조회는 서명된 이미지 출처 인증을 대신하지 않는다.

2026-10-04 13:53 UTC에 이 digest를 `compose.image.yaml`로 기존 **agenttrust 로컬 프로젝트의 API·워커에만** 적용했다. 기존 DB·볼륨·서명 키·loopback 포트를 유지했다. 실제 실행 컨테이너의 digest·revision·격리 설정을 확인하고, 전환 전 생성한 합성 실행과 사용량·감사 기록이 전환 뒤 보존되는지 검사했다. 같은 이미지에서 합성 승인 전 차단·승인 후 서명 검증·반려 후 차단 시연과 자체 세션 정리도 통과했다. 마지막에는 소스 빌드로 API·워커를 복원하고 준비 점검을 통과했다. LogiTrack 자산은 변경하지 않았다.

이는 같은 버전·마이그레이션 이력의 기존 로컬 설치 전환 점검이다. 새 서버 배포, 고객 데이터, 이전 스키마로의 롤백, 무중단 전환, 운영 SLA/RPO/RTO는 검증하지 않았다. 점검 중 API·워커를 재생성했으므로 무중단 절차로 사용하지 않는다. 상세 증거와 전달 파일은 private `.local`에 보관하며 이후 revision에는 새 CI·digest 검증이 필요하다.


## 비교 시연을 포함한 기존 설치 이미지 검증 — v0.113

[고정 CI 실행 37232066978](https://github.com/automaster5013/AgentTrust/actions/runs/37232066978)의 커밋 `0ce3e74bd597544c66b7d2e68c10d57e5efe5353`에서 333개 테스트·후보 발행·이미지 실행·승격이 모두 성공했다. 실제 전달 ZIP 체크섬과 오프라인 묶음, 독립 지정한 저장소·revision·실행/시도·digest의 온라인 GitHub 기록을 대조했다. 이미지 서명이나 독립 provenance 인증을 했다고 주장하지 않는다.

검증 digest `ghcr.io/automaster5013/agenttrust@sha256:c44ef96aa21b89c85205dfd05140142c9d9e531023ae71d077182679b7841cd5`를 기존 agenttrust API·워커에만 적용했다. 실제 이미지 식별·격리, 전환 전후 저장 근거 보존과 기본 10단계·기준 비교 12단계의 서명 시연·정리를 확인하고 소스 컨테이너로 복귀했다. LogiTrack은 변경하지 않았다. 같은 스키마의 로컬 기존 설치 점검이며 새 설치·이전 스키마 롤백·무중단·상용 서버 배포·SLA 검증이 아니다. 보고서와 키는 비공개 `.local`에 보관한다.

## Original-stack delivery validation — 2026-10-11

Implementation revision `15fce601ebdfba5fdf3c886a9a73f3fc27d9e221` passed [original-stack CI](https://github.com/automaster5013/AgentTrust/actions/runs/38147084755) and [legacy installation CI](https://github.com/automaster5013/AgentTrust/actions/runs/38147084593). The authenticated source diagnostic artifact confirms 21 browser tests passed. JSON boundary checks passed ten actual controls in both source and exact registry-image execution environments. Fifteen image/SBOM pairs were independently verified locally, including offline certificate-tampering rejection; see [security evidence](stack-security.md). No production server was deployed.

Local observations: a 180-minute pre-apply read-only soak completed 36,000 requests with zero failures; a separate 90-minute independent-key soak completed 180 signed reviews. After applying only the core and console changes, another 60-minute soak completed 12,000 reads with zero failures and 120 signed reviews. Each completed soak independently verified all 15 business-table fingerprints and its own session cleanup. These synthetic, bounded observations do not establish customer throughput or an SLA.

The existing JavaScript business installation and LogiTrack assets remain preserved. Runtime changes retain two rollback image references. Docker image security evidence covers the 15 listed delivery components; the separate Grafana blocker and production IdP/TLS, trust-key operations and full-system recovery work remain open.

## Original-stack baseline delivery validation — 2026-10-12

Revision `786322d7ce90c226e88a0b360e77bdac16331df5` passed all four [original-stack CI jobs](https://github.com/automaster5013/AgentTrust/actions/runs/38165864678) and the [legacy CI](https://github.com/automaster5013/AgentTrust/actions/runs/38165864562). Authenticated diagnostic ZIP digests matched. The source artifacts contain 23 passing browser tests; both source and exact registry-image artifacts contain six baseline-gate checks and two cancelled-baseline checks. The successful gate path includes actual Python execution, current OPA decisions, independent Java signature verification and natural evidence expiry.

The authenticated 65-file delivery ZIP and every file checksum matched. The independently anchored checksum-map SHA-256 is `645e1c581a2ec200246e092c505b124ee8329f85d99594d1fe2bbf8cfb71ece3`. All 30 image/SBOM signatures for 15 images passed independent local cryptographic verification and a second verification with networking disabled and a separately trusted Sigstore root. A memory-only copy with a certificate-signature byte changed was refused at cryptographic verification even after recomputing its checksum map. The original 65 files remained unchanged.

HIGH/CRITICAL findings were zero in these integrity-verified CI reports. Consumer verification does not perform a new vulnerability scan or re-execute registry images locally. This proof applies to the stated revision; later audit-export and complete-baseline-bundle changes require their own evidence. Grafana remediation, production identity/TLS and trust-key operations, full-system recovery and production deployment remain open. Production approval and paid-provider claims remain false.

## Docker Hub delivery extension — implementation pending activation (2026-10-30)

The existing `original-stack.yml` now has an optional `dockerhub` job after
`security-images`. It reuses the same run's signed security delivery bundle,
rechecks source signatures and all sixteen component records, then pulls each
GHCR digest, tags it with the full revision, and pushes it to
`docker.io/<namespace>/agenttrust-<component>:<revision>`. It reads back the
expected destination digest before issuing a complete publication receipt.
There is no rebuild, `latest` promotion, Compose execution or service change.
This follows Docker's [tag](https://docs.docker.com/reference/cli/docker/image/tag/)
and [push](https://docs.docker.com/reference/cli/docker/image/push/) commands.
A changed registry manifest digest fails publication verification. An interrupted
job may leave some images published; only a receipt with all sixteen records
represents a completed delivery. The destination does not receive a new runtime
execution test or registry-hosted signature/attestation copy. The original signed
bundle and unchanged digests must accompany consumer verification; its GHCR
references and Sigstore identities are deliberately retained.

Activation requires the `dockerhub` GitHub environment, repository variable
`DOCKERHUB_ENABLED=true`, variables `DOCKERHUB_NAMESPACE` and
`DOCKERHUB_USERNAME`, and environment secret `DOCKERHUB_TOKEN` with only the
required repository write access. Confirm account/organization ownership and
create all sixteen repositories with the requested visibility before activation;
this workflow does not set visibility. Never put tokens in chat, files or Git.
Credentials exist only in the temporary runner client configuration and are
removed on completion. PRs cannot publish. GitHub environment protection may
require an approval before the job starts. Main-only source publication and
signing policies are unchanged, so the current draft PR branch cannot publish.

The `stack-dockerhub.py` command defaults to a metadata-only plan; `--publish`
also requires trusted GitHub main execution and cryptographic source verification.
A checksum calculated in the same trusted runner is a transfer-integrity anchor,
not an independently authenticated release selection. A downloaded bundle used
outside that job needs an independently obtained expected checksum and revision.
The receipt explicitly records `serverDeployed: false`.

**Status:** local implementation and offline checks only. Docker Hub account,
namespace, visibility, credential provisioning and deployment target are awaiting
user configuration. No Docker Hub publication or remote CI for this change has
yet been verified. Automatic service deployment is not implemented/activated by
this registry job. Target-specific deployment needs a protected runner/connection,
a health check, backup and compatible migration/rollback policy, and explicit
review of the concrete service changes before the first operational transition.
The preserved 4310 installation and the original technology stack remain distinct
delivery paths; this extension covers all sixteen stack images and does not
replace either installation.

### Confirmed Docker Hub configuration — 2026-10-30

The owner selected personal namespace `automaster5013`, public repositories for
all sixteen `agenttrust-*` images, and the existing `C:\AgentTrust` installation
as the intended CD target. UI/API inspection found the user-created environment
is actually named `AgentTrust-dockerhub` and its existing encrypted secret is
`AUTOMASTER5013_AGENTTRUST`. The workflow references those existing names; the
earlier setup examples using `dockerhub` / `DOCKERHUB_TOKEN` are superseded for
this installation. No secret value was retrieved or copied. Repository variables
`DOCKERHUB_USERNAME=automaster5013`, `DOCKERHUB_NAMESPACE=automaster5013`, and
`DOCKERHUB_ENABLED=false` are configured. Publication remains disabled pending
validation and main release selection.

`dockerhub-auth-preflight.yml` is a credential check on the owned implementation
branch (only pushes modifying that workflow file) or manual dispatch on that
branch/main once GitHub has registered it from the default branch. It performs Docker login on a hosted runner,
removes its temporary credential file, and pushes/deploys nothing. Success proves
authentication only, not repository write permissions or visibility. It consumes
the same existing environment secret as the publication job.

The target currently has no registered GitHub self-hosted runner. Its running
stack uses a private signed-runtime Compose override. A plain source checkout
and `compose up` would therefore omit the actual runtime configuration. CD must
retain that override, restart policies, signing keys, volumes and R/T mounts.
It must preserve the three legacy 4310 containers, Redis, Grafana, and all
LogiTrack resources. `console` and `console-https` are alternative delivered
profiles, not two replacements for the same live container. The sixteen-image
publication receipt alone is insufficient to authorize a local rollout.

Before the first service transition, pin a main release and its authenticated
signed bundle, verify destination digest equality, compare migrations to the
live installation, prove compatible backup/recovery, snapshot rollback image
references and container policies, and present the exact planned service changes.
Only then activate the target-specific rollout. No self-hosted runner, scheduled
poller, automatic service update or operating-system task has been installed by
this configuration step. Main-only signed publication is retained; the draft PR
has not been merged and branch CI success cannot activate that path.

### Read-only local CD planning — 2026-10-30

Run from `C:\AgentTrust`:

```powershell
python scripts/stack-local-cd-plan.py --output .local/cd-review/inventory.json
```

This inventories only the running `agenttrust` project. It refuses missing,
duplicate, unhealthy, unexpectedly named or foreign services and requires the
preserved `unless-stopped` policy for all twenty live containers. Its private
report records immutable rollback image IDs, mount identities without bind-source
paths, current Compose file names and hashes. It does not output environment
values, credentials or raw Docker inspection data. Output must be a new file
inside `.local`; existing reports are not overwritten. It uses only `docker ps`
and `docker inspect`; no container, image, volume or system configuration changes.
The actual owner installation passed this inventory with twenty healthy services.
The report is private `.local/dockerhub-cd-20261030/inventory-v1.json`.

With a real publication receipt, also pass `--receipt`, independently anchored
`--expected-receipt-sha256`, `--expected-revision`, and explicit
`--console-profile development` or `https-review`. A complete sixteen-image
receipt must match the full revision and personal namespace, source/destination
digests and SHA tags. The resulting proposal maps fifteen runtime services to
candidate digests and retains their rollback IDs/policies; the unused console
profile is still published. It excludes legacy api/worker/db, Redis and Grafana.

This is a proposal, not an executor or cryptographic receipt authenticator. It
always reports `automaticDeploymentAllowed: false`. Receipt booleans and a file
checksum do not authenticate release provenance. Main-run and signed-bundle
verification, live migration compatibility, authenticated backup/recovery,
private-overlay/rollback rehearsal, a secured target executor and review of the
first operational transition remain blocking stages. No fabricated release
receipt was applied to the running installation, and no operational CD completion
is claimed. Four offline test groups exercise foreign/unhealthy inventory,
changed policies, incomplete/duplicate images, forged targets, wrong revisions
and alternative console profiles in the existing source-security CI job.

### Signed release / live schema / retained recovery evidence join — 2026-10-30

`stack-local-cd-evidence.py` connects the existing supply-chain signature verifier,
Docker Hub receipt planner and authenticated retained-snapshot verifier. It never
runs the snapshot creation or recovery drill that stops live writers, never
runs migrations, and never deploys. Default mode inventories the twenty healthy
owner containers and reads Flyway history inside an explicit PostgreSQL read-only
transaction with a five-second statement timeout. The candidate revision must
be a full Git SHA. Every versioned SQL migration at that Git revision must match
the live version/script/Flyway CRC32 checksum, with no pending, failed, removed or
changed migration. This intentionally supports same-schema proposals only.
It compares source SQL from the selected Git revision; it does not extract or
execute migrations from an image and does not prove data-semantic compatibility.

The actual `317898a` source catalog matched all **17** live applied migrations,
with zero pending migrations. The inventory and ledger were rechecked at the end.
Private observation: `.local/dockerhub-cd-20261030/migration-binding-v2.json`.
This mode explicitly reports `signedReleaseVerified: false` and
`recoveryEvidenceVerified: false`; it cannot enable CD.

```powershell
python scripts/stack-local-cd-evidence.py --expected-revision <full-git-sha> --output .local/cd-review/schema.json
```

For the joined evidence mode, add `--evidence-config <private-json-file>` and
`--expected-config-sha256 <independently-pinned-config-sha256>`. The operator-owned
config contains these fields (paths refer to existing retained files; it contains
no token or key bytes):

| Field | Meaning |
| --- | --- |
| `revision`, `repository` | Independently selected full SHA and `automaster5013/AgentTrust` |
| `bundle`, `checksumsSha256` | Signed sixteen-image bundle directory and its independently recorded checksum-map hash |
| `trustedRoot` | Optional separately trusted Sigstore root file; otherwise verifier allows public trust-root networking |
| `receipt`, `receiptSha256`, `consoleProfile` | Published Docker Hub receipt, pinned raw-byte SHA-256, `development` or `https-review` |
| `snapshot`, `snapshotId`, `snapshotRevision`, `snapshotManifestSha256` | Existing retained snapshot directory and independent identity/hash anchors |
| `retainedKey` | Existing separately stored owner-protected key file path |
| `recoveryReport`, `recoveryReportSha256` | Operator-trusted existing recovery report and pinned byte hash |
| `maximumRecoveryAgeHours` | Positive maximum age, capped at 24 hours |

The joined mode invokes existing cryptographic verification for every image and
SBOM, binds the publication receipt's source references to the signed bundle and
unchanged destination digests, and reauthenticates all encrypted snapshot
components with the existing key-custody checks. Snapshot decryption is bounded
in local memory using the installed cryptography library; it writes no plaintext,
creates no recovery fixture and changes no key permissions. Signature tooling may
use isolated transient verifier containers; it does not modify existing services.
The historical recovery report must be complete, restored/cleaned, match the
snapshot ID/revision/encrypted manifest hash and all eleven captured image IDs,
match the current runtime images, and be neither stale nor future dated. Snapshot
source SQL must also equal the candidate source catalog. Final checks repeat
bundle, receipt, config, snapshot authentication, recovery-report bytes, inventory
and ledger checks before reporting joined evidence completion.

This does not authenticate a historical local report's truth by itself: its hash
must be independently trusted by the operator. Source signatures do not constitute
an online successful-main-run check, destination pull/readback, production backup
policy or deployment approval. Successful joined checks keep
`automaticDeploymentAllowed: false`, `operationalBackupVerified: false` and
`newRecoveryPerformed: false` and list the remaining release/executor/operational
review blockers. No existing backup was recreated, moved or deleted.

The newest retained coherent-recovery summary found in the existing private
records is dated 2026-10-16 and explicitly reports operational backup unverified.
It cannot satisfy this fresh operational transition check on 2026-10-30. The
current implementation branch also has no published Docker Hub receipt from a
signed main release. Therefore only the real live inventory/schema path has been
executed; the complete signed-publication/retained-recovery path has offline
failure controls but is **not yet verified end to end** with real current release
evidence. Existing services remain unchanged.

### Online main-run and public manifest binding — 2026-10-30

The joined `stack-local-cd-evidence.py` path now also calls `stack_release_online`.
Add independently selected integer `runId` and `runAttempt` to the private evidence
config. The GitHub API run must belong to the owner repository and main branch,
use the original-stack workflow and a push/manual event, match the exact candidate
SHA and attempt, and be completed/successful. All five required jobs, including
Docker Hub publication, must be successful in that same attempt; skipped,
duplicate, missing or extra jobs are refused. The run is rechecked after all
local evidence checks. `GITHUB_TOKEN` may supply existing read credentials via
the process environment; the verifier never obtains tokens from files, expands
permissions, prints them or writes them. Public GitHub reads can be anonymous.
The exact current PR run was read and correctly refused as a trusted main release.

After signed-bundle/receipt binding, all sixteen destination manifests are fetched
anonymously from the public Docker Hub registry using repository-scoped pull
bearer tokens. The exact manifest bytes must hash to the signed source digest and
the registry digest response header must agree. Only supported schema-2 OCI/Docker
manifest media types are allowed. HTTPS origins are fixed, redirects are refused,
responses are bounded to 1 MiB (tokens 64 KiB) and requests have 30-second timeouts.
No Docker Hub account token is used for this public-read step, and no layer blobs,
local images or runtime containers are created by these HTTP checks.

This is manifest availability/integrity readback, not a full image pull, executable
runtime acceptance or continuous availability guarantee. The signed source bundle
continues to carry the original runtime/security evidence. The joined report still
refuses automatic deployment and keeps operational backup/executor/first-transition
review blockers. The full positive path still awaits a real signed main publication
and fresh retained recovery evidence; no synthetic success is substituted.

References: [GitHub workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs)
and [Docker Registry API](https://docs.docker.com/reference/api/registry/latest/).
Four new offline test groups exercise wrong branch/event/SHA/attempt/workflow,
failed/skipped/duplicate/incomplete jobs, modified manifest bytes/digest headers,
foreign namespaces and untrusted network origins. These execute in the existing
source-security CI job before signature/publishing work.

### Two-hour autonomous development window and orchestration controls — 2026-10-30

The owner requested two hours of autonomous continuation starting about 17:18 KST,
ending at 19:18 KST. A new heartbeat on this chat continues CI investigation and
CD implementation within the existing service-preservation boundaries; old
unrelated automations remain untouched. No merge, publication activation, operating
service replacement, writer-quiescing backup or target runner installation is
implied by that development window.

`stack-local-cd-orchestration-test.py` exercises the entire joined evidence path
with simulated external signature, registry, GitHub, snapshot/key and Docker/DB
boundaries. The successful simulation checks repeated snapshot authentication and
main-run verification while deployment and operational-backup claims remain false.
Seven simulated failure variants cover signature rejection, receipt mismatch,
untrusted online release, missing registry manifest, stale recovery, changed live
inventory and changed migration ledger. All fail before joined completion. These
are orchestration tests, not real cryptographic publication or recovery evidence.
The new tests run in the existing source-security job; temporary test files remain
inside the repository workspace.

### Publication receipt bound to the exact main execution — 2026-10-30

Docker Hub publication receipts now use schema version 2. Before pushing, the
publisher requires the exact original-stack main workflow reference and positive
GitHub run/attempt IDs from its trusted runner environment, in addition to its
existing revision/repository/event checks. The receipt records a `publicationRun`
object (`repository`, `workflow`, `runId`, `runAttempt`). Metadata-only plans have
no publication origin and cannot be accepted as a published release.

The local planner refuses legacy schema-1 receipts, missing/wrong workflow origins,
non-integer or zero run IDs/attempts, and malformed source checksum anchors. The
joined evidence verifier additionally requires the receipt run/attempt to equal
the independently selected config run/attempt before querying GitHub. This closes
a gap where a receipt from a different attempt of the same SHA could otherwise
be combined with a successful online run. This is consistent metadata binding;
the receipt hash still needs independent operator trust and does not become a
cryptographic signature of the receipt or an authenticated artifact download.

Focused offline controls cover invalid runner workflow/event/run IDs, wrong
repository, legacy receipts and cross-attempt substitution in the full simulated
join. Forty-two relevant tests and workflow syntax checks passed locally. There
is still no actual Docker Hub publication or operational deployment from this
branch, so no real receipt needed migration and no service was modified.

### Re-enumeration and private Compose drift controls — 2026-10-30

Local planning and the joined evidence path now re-enumerate the running
`agenttrust` project at final validation rather than only inspecting the container
IDs selected at the start. Exactly twenty unique full container IDs must remain
identical; added, removed or replaced services are refused. Existing health,
image/mount/restart metadata must still match the initial summary. This closes
the case where a newly added project container was invisible when only the old
IDs were re-inspected.

Both paths also capture and recheck every current Compose file's bytes, including
the private signed-runtime override. Config files remain within the resolved
repository root, with at most 32 files and 1 MiB per file. Only hashes are retained;
no private configuration contents are printed. An overlay changed during the
joined verification now prevents completion. These remain point-in-time checks,
not a lock against later changes and not permission to apply a rollout.

Focused tests reject added/replaced/missing/duplicate IDs, changed config bytes,
oversized config and a changed private overlay during the complete simulated join.
Forty-four related local tests passed. The real read-only owner inventory again
verified twenty healthy containers and the selected source's seventeen migrations
matched the live ledger, with no pending migrations or service/DB modifications.
Private observations are `inventory-recheck-v1.json` and `schema-recheck-v1.json`
under `.local/dockerhub-cd-20261030`; they do not certify a signed publication.

### Destination platform/config digest identity — 2026-10-30

Joined online readback now anchors `runtime-identity.json` through the signed
bundle's independently pinned checksum map and binds each destination image's
config digest to that runtime image ID. For OCI/Docker indexes it accepts exactly
one linux/amd64 platform manifest, verifies that child manifest's own raw-byte
digest and registry header, and then checks its config digest. Ambiguous or missing
platforms, changed child bytes, wrong config identity and incomplete image-ID maps
are refused. Direct schema-2 image manifests receive the same config-ID check.

This adds a metadata identity check between the published destination and the
exact source image that supplied runtime evidence. It downloads neither image
layers nor config blobs, executes no candidate image and does not infer runtime
success at the destination. The manifest-reading report counts child manifests
separately and explicitly records whether config digests were verified. Existing
signature, attempt, source/destination receipt and backup checks remain required.
Forty-five focused tests passed, including a simulated platform-index success and
four refusal variants; no real published release was substituted by these fixtures.

### Candidate / rollback review overrides and actual runtime groups — 2026-10-30

The local planner now emits review-only `candidateComposeOverride` (only with a
validated schema-2 receipt) and `rollbackComposeOverride` for the fifteen intended
stack runtime services. Each service entry contains only an immutable image
reference and `restart: unless-stopped`; no environment, command, volumes, ports,
keys or health settings are copied or replaced. The rollback proposal uses the
exact currently cached image IDs. Legacy api/worker/db, Redis and Grafana remain
excluded. Neither override is applied or a standalone runnable Compose installation.
Bare rollback image IDs require the existing local cache and must not be treated
as remote registry references or proof of a tested rollback.

Actual owner inspection found **three different ordered Compose file histories**
across the fifteen stack runtime services. `runtimeComposeGroups` preserves each
service's existing sequence rather than selecting one list or taking a union.
`singleRuntimeComposeVerified` is therefore false, and both local planning and
joined evidence explicitly add `per-service-runtime-reconciliation` to their
blockers. This is a concrete reason a generic all-service `compose up` cannot be
approved from these reports. Preserve each private overlay and reconcile effective
runtime settings before any future rollout/recovery execution. The planner emits
no apply command and no executable target agent has been installed.

Private `rollback-review-v1.json` records the real fifteen-service rollback proposal
and the three groups; `runtime-groups-schema-v1.json` confirms the same groups and
all seventeen matching live migrations. Both are under the existing private
`.local/dockerhub-cd-20261030` directory and claim neither publication nor rollback
rehearsal. Candidate override generation has only synthetic receipt coverage because
no real current main Docker Hub receipt exists. Forty-seven relevant offline tests
passed, including unexpected service/image/profile rejection and preserving two
opposite override orderings as distinct groups.

### Hot-updated runtime-policy drift — 2026-10-30

Inventory summaries now include a deterministic `runtimePolicySha256` over selected
resource, isolation, port-binding and process/health metadata. Container IDs alone
cannot detect a hot update of memory/CPU/pid limits; these fields are now covered
by the existing end-of-check inventory comparison as well. Selected fields include
privilege/capability/security settings, namespace modes, resource controls, exposed
port bindings, process user/command and healthcheck metadata. Only the fingerprint
is persisted; raw process settings, environment values and bind-source paths are
not printed or added to the inventory report.

This checks that observed settings remain unchanged during review, not that every
setting is secure or that secrets mounted into running processes are unchanged.
No `docker update` or other policy mutation is performed. Tests alter six synthetic
resource/isolation/process settings while preserving container IDs and verify the
fingerprints change. Forty-eight relevant tests passed. The real read-only twenty-
container inventory also passed with all service-specific Compose groups retained;
the private observation is `runtime-policy-review-v1.json` under the existing
`.local/dockerhub-cd-20261030` directory.

### Three-group comparison and safe transition review — 2026-10-30

`stack-local-cd-reconcile.py --output .local/cd-review/reconciliation.json` compares
all three **existing** ordered file histories using read-only `docker compose
config --no-interpolate --no-env-resolution --format json`. The full rendered
models stay in process memory; only sanitized differences/status are saved. It
inspects already cached images and repeats live inventory/policy/file-hash checks.
It neither pulls images, resolves service environment files nor applies Compose.

The actual sanitized observation is private
`.local/dockerhub-cd-20261030/compose-reconciliation-v3.json`:

| Group | Owned live services | File history | Current finding |
| --- | --- | --- | --- |
| 1 | core API, AI worker, identity (3) | Shared seven files plus historical signed runtime image override | Selected cached image IDs match all three live containers |
| 2 | console, gateway (2) | Shared seven files plus historical application image override | Both current file image declarations differ from the references used to create the live containers; their cached image IDs do not match live IDs |
| 3 | DB, NATS, object store, local model, OPA, quality verifier, OTel, Tempo, Loki, Prometheus (10) | Shared seven files plus runtime and supporting image overrides | Selected cached image IDs match all ten live containers |

All three private override files contain only `image` changes. Their service
coverage overlaps, including console/gateway, so concatenating them can silently
select an older image. All fifteen target service models **excluding image** are
equal across the three rendered histories. Top-level network, volume, secret and
config definitions are also equal. These are uninterpolated model comparisons,
not equality of resolved environment values or live mounted secret bytes.
`runtimeReconciliationPassed` remains false because of the two real image drifts;
`completed: true` means the analysis completed, not that rollout is approved.
Do not repair this drift by reapplying the historical files to healthy services.

The existing runtime policy is `unless-stopped` for all fifteen targets, while the
rendered source has a different/default restart policy for all fifteen. Every
review candidate/rollback image override must therefore keep the explicit runtime
restart setting. The current cached live image IDs remain the rollback baseline;
the group-2 disk declarations are not a valid rollback baseline.

Concrete next transition gates, preserving current operation until review:

1. Freeze the twenty current container IDs, mount/policy fingerprints, fifteen
   cached rollback image IDs and all ordered private-file hashes. Keep legacy
   api/worker/db, Redis, Grafana and every LogiTrack resource outside the target.
2. Build a **new review-only** release override from an authenticated sixteen-image
   main receipt, selecting one console profile and assigning exact digests to the
   fifteen owned runtime services. Do not overwrite the three historical files or
   combine their image declarations. Bind init/migration service images to the same
   core/object release before any future command could start dependencies.
3. Reconcile resolved environment/secret custody separately and render the proposed
   final model in isolation. Its non-image fields and top-level resource identities
   must match the captured effective baseline; restart differences must be explicit.
4. Require the same-schema seventeen-migration ledger check, exact signed main
   run/attempt, public manifest/config-ID readback, fresh authenticated snapshot and
   compatible recovery proof. The old retained drill does not satisfy current
   freshness and is not operational-backup proof. Do not run the writer-stopping
   drill against current services under the keep-running instruction.
5. Rehearse candidate and rollback in an isolated fixture before a concrete first
   transition review. No target executor is installed. A future single-replica
   replacement may interrupt requests; this analysis establishes no zero-downtime
   guarantee. Backing-store upgrades need explicit data-format compatibility and
   recovery review, not an assumed image downgrade.
6. Only after those gates, present the exact affected services, maintenance impact,
   health/readiness checks and recovery actions for the operational transition.
   On a future failure, stop promotion and use only the captured compatible image
   baseline; never downgrade schema or restore over operational volumes automatically.

Five reconciliation test groups cover owning-group image selection, redacted
private-environment differences, missing/duplicate/foreign services or image flags,
resource field differences and project resource definitions. Fifty-three related
local tests passed; current health and source-policy files were not changed.

### Render-only normalization of the current live baseline — 2026-10-30

The reconciliation command now supports `--review-baseline`. It creates an owned
scratch Compose override containing the fifteen **current live** cached image IDs
and explicit `unless-stopped` policies, plus image-only bindings for the one-shot
migration and object-init helpers to their current core/object-store image IDs.
Helpers retain `restart: no`; no automatic migration or initialization is run.
The scratch override is rendered against each existing file group, then removed
from its own temporary workspace. Existing private files, containers and images
are untouched, and the output contains only sanitized comparison results.

For every target, the rendered result must have the expected baseline image and
restart fields. Every other runtime field, every helper field except image, and
all project-level resource definitions must equal the original group model. The
resulting fifteen-service models must also agree across all three histories.
The actual local run passed those render-only checks for fifteen runtimes and two
helpers, proving that an additional **review** override can describe a consistent
current image baseline without inheriting group-2's stale image declarations.

```powershell
python scripts/stack-local-cd-reconcile.py --review-baseline --output .local/cd-review/baseline-render.json
```

Private observation: `.local/dockerhub-cd-20261030/review-baseline-render-v3.json`.
`reviewBaselineModelsEqualAcrossGroups: true` does not repair the existing on-disk
histories: `runtimeReconciliationPassed` remains false and the real image-drift
blocker remains listed. No settings were interpolated, environment files resolved,
layers pulled, candidate images executed, migrations run or runtime policies changed.
This is a render rehearsal of a current-image baseline, not an isolated service
restart/rollback rehearsal or signed candidate release evidence. Fifty-four focused
tests passed, including refusals for helper restart loops, changed non-image
runtime settings and changed project resources during the proposed normalization.

### Signed candidate render path and recovery rehearsal contract — 2026-10-30

The supply-chain/publication part of the joined verifier is now reusable as
`verify_candidate_release`. The reconciliation CLI accepts `--candidate-config`,
`--expected-config-sha256` and `--expected-revision` together. Its pinned private
config uses the existing release fields (`revision`, `repository`, `bundle`,
`checksumsSha256`, optional `trustedRoot`, `receipt`, `receiptSha256`,
`consoleProfile`, `runId`, `runAttempt`). No backup key is required merely to render
a candidate; no recovery or operational-backup success is inferred from that path.

Before candidate rendering it compares the exact candidate source migration catalog
to the live read-only ledger, verifies all source image/SBOM signatures, binds the
schema-2 receipt to the exact successful main attempt, and reads public destination
manifest/config digests. It then generates the fifteen-service digest override,
adding image-only migration/object-init bindings to the candidate core/object-store
images. One-shot helpers must keep `restart: no`; the fifteen runtime services keep
`unless-stopped`. The original models may change only image and the explicit runtime
restart policy: command, environment, mounts, ports, resources, security settings
and project resources must remain identical in each rendered group. All three
candidate runtime models must agree. The CLI also renders the current-image baseline
for recovery review, rechecks artifact/config bytes and the online attempt, and
rechecks the ledger, live inventory and existing Compose hashes afterward.

This is **candidate rendering**, not candidate runtime isolation or deployment.
Its report records `candidateRenderOnly: true`, `candidateImagesExecuted: false`,
`backupOrRecoveryVerifiedHere: false`, and `automaticDeploymentAllowed: false`.
Only signature-verifier tooling may use disposable verifier containers; candidate
layers are neither pulled nor executed by the render path. Existing disk/runtime
image drift remains reported rather than silently repaired. Fifty-five relevant
local tests passed, including full mocked release binding, candidate digest/helper
binding and rejection of stale helper images or non-image configuration changes.
The real current-image render was repeated successfully; the positive signed new
candidate path still awaits real current main publication evidence.

The subsequent isolated runtime/recovery rehearsal must satisfy these concrete
conditions before any operational transition can be reviewed:

- Independently anchor the candidate bundle, publication receipt and main attempt;
  do not select a release from a floating tag or the current PR's green tests.
- Use only owned UUID fixture resources, no host-published ports, Docker socket,
  operational network/volume attachments or bind mounts of operational credentials.
  Copy only authenticated retained snapshot/config material into protected fixture
  custody after explicit preparation. Disable paid/external providers and model
  downloads; preserve the original keys and backup bytes. Do not use a Compose
  render of operational configuration as a runnable fixture definition.
- Start the fixture from the compatible current-image snapshot baseline, record
  state fingerprints, then test the candidate against that isolated restored state.
  Test identity/readiness, actual bounded synthetic evaluation/review, signed gates,
  evidence/object retrieval and persistence; inconclusive or missing evidence blocks.
- On failure stop promotion. Rehearse returning the fixture to the separately
  captured current-image baseline with unchanged compatible schema, then verify the
  same state fingerprints and health. An image-ID rollback alone does not prove
  backing-store data-format compatibility; never perform schema downgrade or restore
  into operational volumes automatically.
- Save only redacted proof, verify fixture ownership before cleanup and prove all
  twenty AgentTrust and twelve LogiTrack operational containers remained unchanged.
  Do not start a writer-quiescing source backup under the current keep-running scope.

No new candidate runtime fixture or target executor has been created by this change.
A fresh compatible authenticated recovery source and a real signed main receipt are
still missing; those are retained as unmet gates, not replaced with mocked success.

### Complete candidate-render orchestration controls — 2026-10-30

The candidate rendering path now has whole-flow simulated tests in addition to
the existing full signed-release/recovery join tests. A successful simulated run
must render both the current-image baseline and candidate, repeat the ledger read,
recheck release artifact/config anchors and the online main attempt, and finally
recheck the live inventory. It must report registry metadata inspection while
keeping candidate execution, backup verification and automatic deployment false.
Five refusal variants cover a rejected trust chain, changed non-image service
settings, changed release artifact identity, final online verification failure and
ledger changes during review. The tests use synthetic boundaries and are not real
signed candidate runtime acceptance or authenticated recovery proof.

Fifty-seven focused tests and workflow syntax checks passed. The real read-only
schema path was rerun after the release-verifier extraction: twenty healthy owner
containers and seventeen source/live migrations matched, with all three private
Compose groups still identified and no operational change. Private observation:
`.local/dockerhub-cd-20261030/candidate-flow-schema-v1.json`.

### Actual pinned-main Docker Hub publication path — 2026-10-30

The owner clarified that actual Docker Hub publication is the priority, rather than
continuing render-only development. A separate, narrowly pinned main-mirror workflow
now publishes the already successful main release `d40cdd063f7f711fdd513d231ec2da2473796619`
from source run `40266953272` attempt 1. All four historical source jobs succeeded;
that workflow predates Docker Hub publication. The authenticated source artifact
`12631309929` ZIP digest is `14cb0e4da4a76d41fa6379a04b145a0633cbf8f3a9835ba5747fc52201a106f5`;
the downloaded ZIP matched and its checksum-map hash is
`36205e03707d098850b99d8fe64d20211b6c7eb134e81082fc4e46ecafc13519`.
The bundle contains sixteen images and schema-7 runtime/security evidence.

`dockerhub-main-mirror.yml` runs only in the owned implementation branch/main,
uses the existing user-provided encrypted publishing secret, re-verifies main-run
identity, all image/SBOM signatures and pinned artifact checksums, and mirrors
unchanged images into public `automaster5013/agenttrust-*` repositories. It performs
anonymous destination manifest/config-ID readback and emits a schema-3 receipt that
separates the original successful main source run from the later publication run.
This is neither publication of the new development branch nor service deployment.
Existing schema-2 consumers deliberately do not silently accept the new receipt
format until their two-run validation path is implemented. The original main-only
build/security pipeline and its defaults remain unchanged; no PR is merged and
no operating container is replaced by the mirror job.

At implementation commit time publication has not yet been verified. A started
job or successful login is not a completed mirror. Completion requires all sixteen
public destination digests/config IDs and the uploaded publication receipt; a failed
push may leave a partial set of repositories. Actual CD remains a separate unfinished
workstream with the existing operational preservation and recovery gates.

### Docker Hub publication completed — 2026-10-30 19:02 KST

**Actual public publication is complete.** The successful publisher run is
[41037195649](https://github.com/automaster5013/AgentTrust/actions/runs/41037195649)
(attempt 1, publisher code `6e6c5dbcec0ec1678709107df6c26802bdafb5b1`). The images
are the already signed/runtime-verified current main source
`d40cdd063f7f711fdd513d231ec2da2473796619`, not the later development-branch changes.
All sixteen public repositories under `automaster5013` now contain that full-SHA tag:

`agenttrust-core-api`, `agenttrust-ai-worker`, `agenttrust-console`,
`agenttrust-console-https`, `agenttrust-opa`, `agenttrust-identity`,
`agenttrust-gateway`, `agenttrust-object-store`, `agenttrust-database`,
`agenttrust-local-model`, `agenttrust-messaging`, `agenttrust-telemetry`,
`agenttrust-tempo`, `agenttrust-loki`, `agenttrust-prometheus`,
`agenttrust-quality-verifier`.

For example: [core API](https://hub.docker.com/r/automaster5013/agenttrust-core-api)
and [console](https://hub.docker.com/r/automaster5013/agenttrust-console).
The job verified all source signatures/SBOMs and all sixteen unchanged public
manifest/config-image digests. It uploaded artifact `12968038833`, whose ZIP hash
`d02ac1216544671e6716f9e9ca5225e1cfa01060dae2cd8ae4938fdadd58492c`
was independently compared after download. The raw receipt SHA-256 is
`488911f4a800eaef56dd78f86c15cb5fdbc812ee053d36b0a7f76283923948b4`.

The first run partially published ai-worker then failed because Docker's local
RepoDigests omitted `docker.io/`; source and target digest bytes already matched.
The normalization fix retained exact digest checks, and the complete retry passed.
No prior partial repositories or other assets were deleted. The one-off mirror is
now manual-dispatch only so later edits cannot unintentionally republish it.

Schema-3 consumers now verify the two executions separately: all four jobs of the
historical signed main source run and the single successful owned publication job,
with independent source and publisher IDs/attempts and the publisher code revision.
Schema-2 normal pipeline receipts still require all five original-stack jobs;
their default requirements have not been weakened. Private schema-3 config adds
`sourceRunId`, `sourceRunAttempt`, and `publicationRevision` to the existing explicit
publication `runId`/`runAttempt`. Context, cross-attempt and full mocked-join controls
passed; sixty-two relevant unit tests and workflow syntax checks passed locally.

The **real published candidate render path also passed locally** using the actual
signed bundle, authenticated receipt and exact successful source/publication runs.
It cryptographically reverified source signatures, read back public destination
manifest/config IDs, matched the seventeen live migrations, rendered baseline and
candidate models across all three current Compose groups, and bound both one-shot
helpers. Private evidence is under `.local/dockerhub-main-d40cdd0-20261030`.
The report explicitly keeps `candidateImagesExecuted: false`,
`backupOrRecoveryVerifiedHere: false`, and `automaticDeploymentAllowed: false`.
The two historical disk/runtime image drifts remain reported, not repaired.

**Actual service CD remains unfinished.** Publication does not install a target
executor, create fresh compatible recovery evidence, execute an isolated candidate
or approve the first operating transition. Those remain required before enabling
service automation. No branch PR was merged and no service was deployed. All twenty
AgentTrust operational container IDs and image IDs matched the original inventory;
AgentTrust twenty and LogiTrack twelve remained healthy.

### Published worker isolated execution work — 2026-10-30

`stack-isolated-worker-rehearsal.py` adds a bounded stateless worker ASGI fixture
using the actual published digest and the captured current worker image ID. It
verifies the signed publication, pins the candidate's cached config image ID,
and intends to run candidate/baseline/candidate in owned disposable containers.
Each has network `none`, no published ports, no mounts, nonroot UID 10001,
read-only root, dropped capabilities and bounded CPU/memory/pids/tmpfs. Fixture
authentication tokens are generated only in container tmpfs and are never printed.
The probes use the image's real `/evaluate` ASGI API for pass/block/missing/error,
unauthenticated rejection and caller-selected external URL refusal. No queue,
database, stateful recovery, paid provider or operational credential is used.

Actual separate published-candidate and current-baseline fixture executions both
returned the expected results with network disabled. The initial integrated wrapper
failed without completion; diagnostic stages and explicit UTF-8 subprocess decoding
were added before retry. Therefore the initial wrapper result is not accepted as
an integrated rehearsal success. The retry is tracked separately in private evidence;
no full-stack or operational rollback claim follows from these stateless probes.
Two fixture command boundary tests passed in addition to the previous sixty-two
related tests. Existing source container IDs/images and services remain unchanged.

The real operating deployment executor is still unimplemented. The existing cold
recovery tool's read-only preflight passed eleven services/five stateful volumes,
but a fresh coherent source backup would quiesce writers and is not authorized by
the current keep-running scope. Neither a successful stateless worker probe nor
rendering an override removes that prerequisite for an operational transition.

### Verified isolated execution and guarded CD executor — 2026-10-30

The integrated worker retry succeeded. Docker Desktop's containerd image store
reports a manifest digest as `docker image inspect .Id`, whereas the classic
store reports the config digest. `stack_image_identity.py` accepts either only
after authenticated registry manifest/config binding, exact repository digest
membership, Linux/amd64 checks and, for the manifest representation, matching
Descriptor digest/media type. It does not relax signature or public readback checks.
The real published candidate/current baseline/candidate sequence passed all three
bounded ASGI fixtures with equal results. No operating container was replaced.

`stack-isolated-database-rehearsal.py` also completed a real published PostgreSQL
image rehearsal in two owned, disposable containers with network none, no host
ports, no mounts/persistent volumes and bounded tmpfs/resources. Seventeen pinned
SQL migrations and three synthetic tenant audit rows were dumped in memory,
AES-GCM encrypted/authenticated, restored into the second fixture and compared.
Row fingerprints, RLS policies, restricted tenant visibility and pgvector queries
passed; modified ciphertext was refused. Both fixtures were removed. This used
synthetic data and direct SQL migrations, not the Flyway engine or an operational
database dump. It proves neither a fresh operating backup nor full-stack recovery.
Private reports: `isolated-worker-rehearsal-v3.json` and
`synthetic-database-recovery-v1.json` under the retained publication directory.

The actual Compose deployment execution path now exists in
`stack-local-cd-deploy.py` and `stack_local_cd_executor.py`; the previous statement
that it was unimplemented is superseded. Its default prepare path passed against
the live inventory and all three resolved Compose groups, protecting twenty
configuration/environment/bind files by digest without printing their contents.
The prepare report is read-only and explicitly disallows automatic deployment.

Execution requires separately pinned plan/approval files, exact service scope,
a fresh approval window, explicit same-schema recreation/rollback consent,
authenticated fresh recovery evidence bound to the current source configuration,
and an operator-trusted, pinned full-stack candidate recovery proof. These last
proof requirements remain unfulfilled. The full-stack proof is supplied evidence,
not generated or independently established by the worker or database fixtures.
Only the fifteen allowlisted stack runtime services can reach Compose. Commands
use the captured project/files/environment plus the pinned override, one service
at a time, `--no-build --pull never --no-deps --wait`. Legacy services and one-shot
helpers cannot be targets. File/ledger/source identity and unaffected-service
checks precede transitions. Stateless failure rolls back touched services in
reverse order; touching stateful services prevents an automatic image downgrade
and requires manual recovery review. Private append-only journals distinguish
started mutation, verified service replacement and failed/rolled-back execution.

Approval JSON must bind `planSha256`, exact `services`, UTC `issuedAt`/`expiresAt`,
`allowServiceRecreation`, `allowSameSchemaImageRollback`,
`localDevelopmentRecoveryScopeAccepted`, `isolatedFullStackProof` and its
`isolatedFullStackProofSha256`; stateful targets also require
`statefulTransitionReviewed`. Approval must be no older than ten minutes, unexpired,
and cover at most thirty minutes. This file is an explicit operator action and is
not generated by preparation. No approval file was created for the live services.

Seventy-nine focused tests passed, including complete mocked execution with real
command construction/journaling, success, reverse rollback, missing-evidence
refusal, stateful failure and source-configuration drift. Mocked orchestration is
separate from the real bounded worker/database fixtures. Workflow lint passed.
No real deployment execution, scheduler installation, fresh quiescing backup or
operational container recreation occurred. AgentTrust twenty and LogiTrack twelve
remain healthy; the forty-two containers and eighteen volumes are preserved.
Actual unattended service CD remains incomplete until compatible fresh recovery,
full-stack rehearsal and the reviewed operating transition are satisfied.

### Non-quiescing online evidence and isolated logical recovery — 2026-10-30

`stack-online-recovery.py` adds a keep-running path. It verifies the published
signed candidate, exact twenty-service live baseline, all three resolved Compose
groups and protected source files before taking bounded online `pg_dump` archives
of `agenttrust_stack` and `agenttrust_stack_identity`, role definitions, runtime
configuration and business fingerprints. PostgreSQL takes an independent logical
snapshot per database; these are explicitly not a cross-database/cross-store
atomic snapshot. No source service is stopped, paused, recreated or restored over.
DDL lock acquisition is bounded to five seconds. Private bytes remain in memory
or owner-protected AES-GCM archives. A generated retained local key is kept in a
separate owner-protected directory; no key/configuration/row content is printed
or committed. This is local custody, not offsite or production KMS evidence.

The new verifier supports a fresh process with separately pinned snapshot ID and
encrypted manifest SHA-256, checking freshness, the exact component set, component
hashes, authenticated decryption, source configuration/image bindings and scope.
It refuses wrong keys, altered components and a false cross-store atomicity claim.
The execute path invokes it before fixture startup. The retained archive from the
actual successful run was separately verified in fresh positive/wrong-key
processes: the wrong key produced `InvalidTag`; archive and retained key bytes
remained unchanged. Key material was never output.

Actual successful evidence is retained privately under
`.local/stack-coherent-recovery-88e1fde3-e9cb-46f8-80c5-fa2f0773dd64`.
Both real operating database archives restored successfully into an owned tmpfs
PostgreSQL candidate. All eighteen business table fingerprints matched; the source
business rows, operating container IDs/images and protected configuration remained
unchanged. Eleven business-path services started on one new internal network with
no published host ports or operating volume mounts. Candidate images were resolved
through the signed manifest/config chain; preserved Redis used its captured current
image. The restored identities completed real OIDC/PKCE authentication, role/tenant
refusals, a new Python/NATS synthetic evaluation, manual approval, idempotent replay
and a verified new MinIO evidence archive. All fixture containers/network and copied
private runtime files were removed. No persistent fixture volumes were created.

The first attempt reached restored service startup and equal business fingerprints
but failed its application probe; it is not accepted as success. Diagnostics and a
bounded asynchronous archive-read retry were added before the successful retry.
The first attempt's precise probe failure was not retained, so it is not assigned
a definitive cause. Both attempts preserved the original services and cleaned their
owned fixtures.

This is **partial online logical recovery**, not full operating stack recovery.
Historical locked MinIO version IDs, JetStream queue state, Redis sessions/quotas,
observability history/services, local model cache/inference, legacy services and
production RPO/RTO remain excluded. Empty fixture object/queue/session stores only
validate new work after database recovery. `fullStackRecoveryVerified` and
`coherentOperatingBackupVerified` remain false; the existing deployment recovery
gate rejects this evidence. The cold coherent tool still requires quiescing nine
services and was not executed under the keep-running instruction. The real CD
executor remains prepared but inactive until complete compatible recovery evidence
and a reviewed transition exist; publication and successful online probes do not
activate it. The published candidate is pinned main revision `d40cdd0`, distinct
from these deployment-tool branch commits.

Nine focused tests cover the complete mocked eleven-service restore, failure
before application startup, owned-target boundaries, fresh archive authentication,
wrong-key/tamper rejection and refusal by the operating recovery gate. They also
pass inside the pinned source-security image used by CI. Together with the existing
seventy-nine related tests, eighty-eight tests pass locally; workflow lint passes.

Windows retained-key validation additionally found that Python's
`mkdir(mode=0700)` can leave explicit Administrators/OWNER RIGHTS entries after
inheritance removal. The new key-directory creator removes those explicit entries
and validates the resulting owner/SYSTEM ACL before writing a key. Only the two
newly generated online-recovery key directories were corrected; their key bytes
were preserved. The successful retained archive then passed the existing strict
custody validator and fresh-process authentication again. A boundary test covers
that ordering. The focused total is ten new tests plus seventy-nine existing
related tests (eighty-nine); the new tests pass on Windows and inside the pinned
Linux source-security image.

### Historical versions, durable queue and quota recovery — 2026-10-31 KST

The preceding commit `89a2b1b` finished all five PR workflows successfully,
including Original stack integration run `41051574958`. This CI result is separate
from Docker Hub publication and operating CD activation.

`stack-online-recovery.py --execute --include-live-state --state-stores-only`
now captures bounded read-only copies of the owned MinIO, NATS and Redis volumes.
Each source volume's exact Compose labels/name are checked, helpers have no network
and mount the source read-only, and adjacent copies must have equal file bytes and
modes. No writer is quiesced. Source stream/durable positions must also stay equal.
State, source configuration, logical databases and DB-pinned version references are
retained only in authenticated encrypted archives with a separately retained,
owner/SYSTEM-protected local key. Fresh-process verification authenticates all
three added archives and their file fingerprint maps. These live copies remain
explicitly non-atomic across stores/databases and are not an operating backup claim.

Actual successful evidence is private under
`.local/stack-coherent-recovery-93cb321b-bd0a-4535-b3a1-27ef449da433`.
Only three storage services were started in this successful run. Three new owned
volumes were restored with exact file fingerprints before startup; original volumes
were never restore targets. Published signed MinIO/NATS candidates and captured
Redis image identity ran on a fresh internal network without host ports. The bounded
queue client uses the signed published worker image, not an operating worker.

- All **774 database-pinned historical object versions** returned their exact
  original version IDs, sizes and SHA-256 values from restored MinIO. This verifies
  DB-referenced versions, not an independently enumerated list of orphaned versions.
  The read-only probe signs fixed-endpoint requests using the
  [AWS SigV4 canonical request contract](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html),
  refuses redirects/proxies and never prints authorization headers or object bytes.
- Both captured JetStream streams and durable consumer positions matched before
  any fixture mutation. The source had no pending stored messages. An additional
  opaque synthetic message was then published only into the restored empty
  `STACK_EVALUATIONS` stream, survived a fixture NATS restart and was fetched with
  exact bytes and durable ACK position. No source message was published/consumed.
  This proves queue persistence/replay, not recovery of a captured business backlog.
- Forty quota keys found in the bounded Redis incremental AOF were checked with
  existing restricted `GET`/`TTL` permissions. All were already expired; none was
  resurrected. A separate owned fixture quota counter survived its Redis restart
  and later expired naturally. No source counter, ACL or configuration was changed.
  Redis memory keys are not globally enumerated, so that coverage flag remains false.

Earlier attempts are not accepted as complete proofs: a PostgreSQL multiline JSON
framing issue and AOF parser bound were corrected; a full eleven-service attempt
aborted when an operating health precondition failed. Its owned fixtures were
removed, original IDs/images stayed unchanged, and all twenty operating services
were subsequently healthy. The reduced three-store path avoids that unnecessary
concurrent JVM load. A later queue test initially hit the normal 32 MiB reservation
limit because the two restored streams already reserve 16 MiB each. The successful
probe reuses the restored empty stream; it neither creates another stream nor
raises the server's limits. Regression tests protect these boundaries.

Session scope is now explicit. Current Java OIDC sessions use an in-memory registry
and servlet sessions; Redis stores gateway quotas, not those login sessions. The
new CD approval contract requires `allowSessionReauthentication: true` whenever
`stack-core-api` is a target. No operating approval was generated. The isolated API
restart/old-cookie rejection exercise remains uncompleted because the full-stack
attempt was stopped by health protection; seamless existing-cookie continuity is
not claimed. The previous successful eleven-service probe separately establishes
fresh OIDC login and new evaluation after database recovery.

The successful store report keeps `fullStackRecoveryVerified: false` and
`actualDeploymentPerformed: false`. Cross-store atomic consistency, JVM session
continuity, the API restart/re-authentication exercise, monitoring/model state and
reviewed operating transition remain gaps. Existing deployment gates still reject
partial online evidence; no publishing switch, scheduler, merge or operating
container recreation was performed. All owned fixture containers, volumes, network
and temporary copied secrets were removed. Original twenty AgentTrust and twelve
LogiTrack services, forty-two containers and eighteen volumes remain preserved.

One hundred eight related tests pass locally, including full mocked store/fault
orchestration, exact version/hash refusal, source/foreign target refusal, TTL
non-resurrection, durable replay against the existing stream reservation, archive
fingerprint tampering, and explicit session re-authentication consent. New archive
and live-state tests also run in the pinned Linux security image in CI.

### Isolated API restart and joined recovery evidence — 2026-10-31 KST

`stack-online-recovery.py --execute --session-only` adds a bounded four-service
phase: restored PostgreSQL, restored Keycloak, signed API and signed console. It
requires at least 2 GiB of reported Docker working-set headroom before startup,
checks at least 512 MiB during checkpoints, and continues to enforce all twenty
operating services' exact IDs/images/health and protected source configuration.
The successful preflight reported about 3.05 GiB free in the 7.52 GiB Docker VM.
These are local fixture guards, not production capacity or HA evidence.

Only the fixture console's `CORE_API_URL` points directly at the fixture API. The
original gateway route remains unchanged. This phase deliberately omits gateway,
quota, queue, object storage and inference paths already covered separately; it
must not be presented as another full-stack startup. Both real operating logical
database archives and roles restored into owned tmpfs; all eighteen business table
fingerprints matched before candidate startup. No source writer was quiesced.

Actual successful proof is private under
`.local/stack-coherent-recovery-fd01fe4f-4ef8-4584-9938-6f68841967c5`:

- Real OIDC authorization-code/PKCE login succeeded using restored identities.
- A separate probe process authenticated the saved fixture cookie before restart.
- Only the owned fixture API restarted. Its ID and image stayed equal while its
  start time changed; source/foreign targets remain refused by ownership guards.
- The same cookie received HTTP 401 after restart. A fresh OIDC login and logout
  succeeded. Existing-cookie continuity remains false and re-authentication remains
  required; the earlier `allowSessionReauthentication` approval requirement stands.
- Source business rows, original container IDs/images and protected configuration
  remained unchanged. Four fixture containers, internal network and temporary
  private configuration/cookie mounts were removed. No persistent fixture volume
  was created. The capsule was retained only as authenticated ciphertext.

`stack-recovery-evidence-join.py` now joins separately pinned application, store and
session proofs against the current unchanged source. Its input is itself SHA-256
pinned. Each phase must have exact proof and encrypted-manifest hashes, an authenticated
retained key/archive, a matching fixture ID, candidate revision and source image
map, complete nested subproofs, a capture timestamp inside the proof window, and
completion/freshness within twenty-four hours. Authenticated configuration and
business fingerprints must equal the current source, not merely another report.
The signed publication is reverified, source state is rechecked after all phases,
and any data/config/revision/freshness drift refuses the join.

The real join passed for the earlier eleven-service evaluation proof, the
774-version/queue/quota store proof and this API session proof. It bound twenty live
services and eighteen business tables. Private review records are
`phased-recovery-config-v1.json`, `phased-recovery-evidence-v1.json` and the stricter
nested-completion contract readback under the retained publication directory.
`phasedBusinessRecoveryEvidenceVerified` is true, while
`fullStackRecoveryVerified`, `operationalBackupVerified`,
`automaticDeploymentAllowed` and `actualDeploymentPerformed` remain false.
Phased observations do not establish an atomic cross-database/cross-store point.

A read-only inventory also bounds the remaining state: local model cache about
499 MiB (runtime mounted read-only), Tempo about 6.74 GiB, Loki 312 KiB, Prometheus
about 30.6 MiB and Grafana about 1.59 MiB. These volumes were measured through
ownership-checked read-only helpers, not restored or copied as complete backups.
The model/Tempo exceed the existing single-envelope/archive limits. Chunked or
service-native consistent backup/restore is still needed for those histories;
no large live copy, model download, source restart or asset deletion was attempted.
The inventory explicitly marks every additional service `recoveryVerified: false`.

Four session tests and eight phase-join tests cover complete mocked restart/join
orchestration, capacity refusal, pre-restart source-health refusal, private cookie
handling, mixed revision/image/configuration scopes, incomplete nested proofs,
snapshot timing, post-verification data drift and refusal to promote phased evidence
to deployment consent. Together with the previous 108 checks, 120 related tests
pass locally. The session tests also pass in the pinned Linux security image.
Actual operating deployment, source stop/recreation, publishing activation and
scheduler installation remain unperformed.
