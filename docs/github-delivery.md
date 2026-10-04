# GitHub CI와 이미지 전달

대상 저장소: https://github.com/automaster5013/AgentTrust . 사용자가 지정한 범위는 소스 업로드, CI, Docker 이미지 빌드·보관과 수동 배포 준비이며 현재 연결할 서버는 없다.

## 자동 검증과 이미지 보관

`.github/workflows/validate.yml`의 Validate and deliver는 main push, PR, 수동 실행을 지원한다. test 작업은 구문·전체 테스트·의존성 audit, Docker 평가와 재시작 지속성, CI 서명, 관리자 승인/반려, 반복 평가, 워커 중단 복구, 백업 인증 실패와 정상 격리 복원을 검증한다. 각 runner의 Compose 프로젝트는 실행 ID로 분리하며 마지막에 해당 서비스를 종료한다. 실제 고객 데이터나 로컬 비밀을 runner에 주입하지 않는다.

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

`runtime_verified`는 후보 실행 검증 완료 상태다. 승격 작업은 같은 실행·시도·revision·digest의 명세인지 먼저 확인하고, Docker push 성공 후 별도 작업 요약에 `state: promoted`, `promotedAt`을 기록한다. 이 최종 요약에서 JSON을 복사해 수동 배포 기록으로 보관할 수 있다. `serverDeployed: false`는 실제 서버 배포를 수행하지 않았음을 나타낸다. 요약은 해당 Actions 실행에 연결되며 별도 다운로드 artifact나 release를 만들지 않는다.

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
