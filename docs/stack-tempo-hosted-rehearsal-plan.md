# GitHub-hosted Tempo warm 역이동 지표 검증 설계안

상태: CI 전용 하네스·workflow 구현 및 로컬 모의 테스트 완료. 실제 hosted 실행 결과는 별도 CI run으로 확인해야 한다. 로컬 메모리 회수·대기는 중단한다. 기존 Windows 서비스·현재 대화·운영 파일은 이 계획의 실행 대상이 아니다.

## 목적과 결과의 범위

GitHub가 제공하는 별도 Linux VM에서 실제 게시된 Tempo 바이너리를 실행하고, 합성 데이터의 cold 404 → 무재시작 분리 복구 → warm 역이동 후 새 폴링 오류와 정상 조회 유지를 관측한다. 이는 소스 추론이나 mock과 다른 실제 바이너리 동작 증거다. 다만 운영 원본 트레이스·백업을 보내지 않으므로 운영 데이터 복구·현재 운영 404 해결·전체 CD 완료의 증거로 승격하지 않는다. 합성 20개·133개는 기존 운영 관측과 개수만 같으며 같은 데이터가 아니다.

## 실행 환경과 비용 경계

- `ubuntu-24.04` x64 표준 GitHub-hosted runner 1개, job 상한 45분, 내부 실행 최대 38분과 정리 여유 3분. 예상 25~40분이지만 queue·pull 지연은 별도다.
- 공개 저장소 표준 Linux runner는 현재 4 CPU·16GB RAM·14GB SSD이고 사용료가 무료다. 실행 전 저장소가 여전히 Public인지 확인하며, private/larger/self-hosted runner나 추가 결제 설정으로 자동 전환하지 않는다. [GitHub 공식 사양](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- runner 여유는 시작 4GiB / 진행 2GiB 이상을 확인한다. 이는 Windows 시작 2GiB / 진행 1GiB 정책을 완화하는 것이 아니라 다른 환경의 별도 프로필이다.
- writer·정상 기준 reader·오류 주입 reader는 순차 실행해 동시에 Tempo 1개만 유지한다. 초기 비교 프로필은 기존 격리 실행과 같은 512MiB·1CPU·pids 128이며 OOM·재시작은 실패다. 메모리를 자동 증액해 실패를 숨기지 않는다.
- `GITHUB_ACTIONS`, Linux, GitHub-hosted 환경, 저장소, runner 임시 경로와 로컬 daemon context를 확인한다. 외부 `DOCKER_HOST`나 Windows·self-hosted 환경은 거부한다.

## 서명된 게시 이미지의 고정점

| 항목 | 고정값 |
| --- | --- |
| 공개 Tempo 이미지 | `docker.io/automaster5013/agenttrust-tempo@sha256:9a3da9953ef6376a6589a325ead853d3f170f08e8e1862e45a6171a71d7c14ee` |
| 이미지 빌드 revision | `d40cdd063f7f711fdd513d231ec2da2473796619` |
| source delivery run / attempt | `40266953272 / 1` |
| source checksums.json SHA-256 | `36205e03707d098850b99d8fe64d20211b6c7eb134e81082fc4e46ecafc13519` |
| Docker Hub 게시 run / attempt | `41037195649 / 1` |
| 게시 workflow revision | `6e6c5dbcec0ec1678709107df6c26802bdafb5b1` |
| 게시 receipt SHA-256 | `488911f4a800eaef56dd78f86c15cb5fdbc812ee053d36b0a7f76283923948b4` |
| Tempo upstream source | `77fc4563d1135d0ca2656709c7384c278a9c67b0` |

러너는 지정된 GitHub run의 공개 소프트웨어 delivery·게시 receipt artifact만 다운로드한다. 로컬 `.local` 번들을 업로드하지 않는다. 기존 `stack-delivery-verify.py`의 중복 JSON·체크섬·revision 검증을 재사용하고, manifest에서 Tempo 레코드의 서명·SBOM 번들을 검증한다. 현재 전달 형식은 `cosign verify-blob-attestation` 번들이므로 Docker Hub에 registry 서명이 있다고 가정해 단순 `cosign verify <image>`만 실행하지 않는다.

인증서는 repository `automaster5013/AgentTrust`, workflow `original-stack.yml@refs/heads/main`, issuer `https://token.actions.githubusercontent.com`, 이미지 빌드 SHA를 모두 고정한다. cosign v3.1.3은 기존 저장소의 검증된 SHA-256 `4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71`로 설치한다. signature·artifact가 없거나 만료되면 실패하고 mutable tag나 로컬 사본으로 우회하지 않는다. Linux/amd64 manifest → config digest → 실제 image ID 연결도 기록한다. 빌드 SHA·게시 SHA·새 하네스 SHA는 서로 구분한다.

## 합성 데이터와 backend-only 기준 만들기

1. Python 표준 라이브러리로 명시적 trace ID 20개를 만든다. 13개에 7 spans, 7개에 6 spans를 넣어 총 133개로 고정한다. 부모 관계·시간·속성·합성 service.name도 검증한다. 실제 사용자·tenant·세션·secret·운영 trace ID는 사용하지 않는다.
2. 실행마다 UUID 라벨과 정확한 이름 목록을 가진 writer volume/container를 만든다. OTLP HTTP로 fixture에만 전송하고 실제 닫힌 block·유효 meta.json·안정된 파일 집합 생성을 기다린다. 상한 10분 내 durable block이 없으면 실패한다.
3. writer만 정지하고 닫힌 block 파일만 새 소유 volume에 복사한다. WAL·live-store 데이터·기존 tenant index는 복사하지 않는다. 정상 reader는 OTLP를 한 번도 받지 않은 새 컨테이너다.
4. 새 정상 reader에서 명시적인 20 ID를 전부 조회해 133 spans와 의미 해시를 기준화한다. 검색 API의 임의 첫 20개나 HTTP 200만을 기준으로 쓰지 않는다. JSON 변환 차이는 기존 `trace_fingerprint`로 정규화하되 원래 span ID·이름·부모·속성·시간도 합성 명세와 대조한다.
5. 기본 API와 함께 `/querier/api/traces/<id>?mode=blocks&...`를 고정 allowlist probe에서 확인해 backend 조회임을 입증한다. 현재 운영용 probe의 allowlist를 넓히지 않고 CI 전용 helper를 둔다. [Tempo API](https://grafana.com/docs/tempo/latest/api_docs/)

3.1.0 monolithic은 저장소의 최소 구성과 `-target=all`을 사용한다. 확인되지 않은 2.x ingester 설정이나 `/flush` API를 가정하지 않는다. [고정 소스의 monolithic 안내](https://github.com/grafana/tempo/blob/77fc4563d1135d0ca2656709c7384c278a9c67b0/docs/sources/tempo/set-up-for-tracing/setup-tempo/deploy/locally/linux.md)

## 무재시작 대조 실험

| 단계 | 동작 | 필수 증거 |
| --- | --- | --- |
| A 정상 기준 | 위 정상 reader 조회 후 소유 reader만 종료 | 20 ID·133 spans·의미 해시, 닫힌 정상 block manifest |
| B cold 오류 | 새 volume에 정상 block과 합성 빈 block 2개를 넣고 후보를 1회 시작 | 각 빈 디렉터리의 4개 파일은 0바이트, meta.json 포함. 초기 404·JSON 오류·해당 tenant counter 확보 |
| C hot 분리 | 후보는 계속 실행, 정확한 두 소유 block 디렉터리만 backend 밖으로 이동 | 파일 hash·mode·집합 보존, 후보 ID/image/StartedAt 유지 |
| D 자연 폴링 복구 | 기본 5분 주기를 변경하지 않고 상한 15분 관측 | 신규 성공 poll 2회 이상, 마지막 두 완료 구간 오류 증가 0, 20/133 의미 해시 일치 |
| E warm 역이동 | 정확한 두 디렉터리를 원래 위치로 이동 | 목적지 부재·symlink 부재, 8개 파일 불변, 무재시작 |
| F 지표 판정 | 상한 15분 안에 같은 tenant의 새 poll 오류와 전체 조회를 함께 관측 | 해당 tenant error delta > 0 + 20/133 해시 일치이면 retained-good-blocklist. 다른 tenant 증가만으로 성공하지 않음 |

원래 reader에 수집 중인 span이 없으므로 ingester/live-store의 잔존 trace로 통과할 수 없어야 한다. `/status/config`에서 실제 적용된 `storage.trace.blocklist_poll`을 읽고 구성 해시와 함께 보존한다. 기본값과 실제값이 다르면 판정을 멈춘다. 5분은 고정 소스의 기본값이며 추정값만으로 두 poll 완료를 세지 않는다.

카운터는 `tempodb_blocklist_poll_errors_total{tenant=...}`와 `tempodb_blocklist_poll_duration_seconds_count`를 전후 및 중간 시점에 수집한다. 기존 `stack_tempo_poll_evidence.py`를 재사용해 누락·NaN·음수·시리즈 변경·개별 reset·합계 불일치를 거부한다. F에서 poll 성공 횟수 증가가 없더라도 오류 분기의 이전 목록 유지는 가능하므로 성공 poll과 실패 poll을 구분한다. 404가 다시 나오면 별도 결과로 남기고 warm 목록 유지 성공으로 표시하지 않는다. ID·image·StartedAt·RestartCount 0·OOM false·ready는 모든 단계에서 확인한다.

## 격리·권한·증거

- `permissions: contents: read, actions: read`; checkout credential 지속 저장 없음. Docker Hub token·운영 secret·environment·SSH·self-hosted runner·운영 주소를 사용하지 않는다. 새 서명·push·deploy 권한도 없다.
- Tempo는 `--network none`, 호스트 포트 미게시, read-only rootfs, 비root UID, cap drop, no-new-privileges를 사용한다. probe와 OTLP sender는 확인된 소유 Tempo의 network namespace만 공유한다.
- helper는 저장소에 이미 고정된 `python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72`로 실행한다. mount는 소유 runner 임시 디렉터리의 읽기 전용 스크립트만 허용한다. 데이터 쓰기는 소유 임시 디렉터리에만 한정한다.
- 재사용할 기존 함수는 metrics 판정, 의미 fingerprint, 소유 파일 inventory·quarantine·inverse다. Windows의 32개 보호 서비스와 운영 source volume을 찾는 기존 `run()`은 호출하지 않는다. CI 전용 하네스가 별도 자산 그래프를 만든다.
- 항상 실행되는 cleanup은 생성 receipt의 정확한 ID와 UUID 라벨을 다시 확인하고 해당 fixture만 정리한다. 전역 prune·광범위 이름 검색 삭제는 없다.
- artifact는 합성 명세 해시·정상/회복/역이동 trace 해시·counter 원문/시계열·유효 설정·이미지/인증서 검증 영수증·단계 시간·정리 결과를 보존한다. 환경 전체 덤프·토큰·로컬 파일·운영 증거는 업로드하지 않는다. retention 7일을 제안한다.
- 최종 receipt의 `syntheticWarmMetricProofVerified`만 조건부 true다. `operatingTempoRecoveryVerified`, `operationalBackupVerified`, `fullStackRecoveryVerified`, `actualCDPerformed`, `automaticDeploymentAllowed`는 항상 false다.

## 구현·실행 경로

구현 파일은 CI 전용 `scripts/stack-tempo-ci-rehearsal.py`, allowlist probe/sender, 전체 경로 mock·실패 테스트, `.github/workflows/tempo-warm-rehearsal.yml`이다. 실제 바이너리 검증 성공은 hosted run의 독립 재계산까지 통과해야 인정한다.

새 workflow는 우선 동일 저장소 PR의 관련 경로 변경에만 연결하고 기존 전체 integration과 독립된 job으로 둔다. 기존 전체 CI를 기다리거나 다시 16개 이미지를 빌드할 필요가 없다. checkout·artifact actions는 저장소에서 사용 중인 검증된 commit SHA로 고정하고 publish job에 연결하지 않는다.

새 `workflow_dispatch`만 추가한 feature branch를 곧바로 수동 실행할 수 있다고 가정하지 않는다. GitHub는 workflow 파일의 default branch 존재 조건을 둔다. 따라서 미병합 PR 실행 경로를 먼저 사용한다. 별도 default-branch 등록이 필요해도 이번 계획을 이유로 main merge를 하지 않는다. [GitHub 이벤트 문서](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)

구현 후 순서는 mock/실패 테스트 → workflow 정적 검사 → PR의 hosted 실행 → 실제 artifact 독립 재계산이다. 404·의미 해시 불일치·관련 counter 부재/리셋·타임아웃·OOM·정리 실패는 전부 별도 실패/판정 불가로 보존한다. 결과를 검토한 뒤에만 운영 원본을 보존한 별도 복구 계획에 참고하며 자동 CD로 연결하지 않는다.

## 2026-10-31 artifact 가용성 사전 확인

GitHub API에서 다음 두 artifact가 지정된 run에 있고 만료되지 않았음을 확인했다. 이는 검증 입력 가용성 점검이며 hosted Tempo 실행 증거가 아니다.

| 용도 | Artifact ID / 정확한 이름 | ZIP SHA-256 | 만료 UTC |
| --- | --- | --- | --- |
| 서명 delivery | `12631309929` / `original-stack-security-delivery-d40cdd063f7f711fdd513d231ec2da2473796619` | `14cb0e4da4a76d41fa6379a04b145a0633cbf8f3a9835ba5747fc52201a106f5` | 2026-11-25 06:47:02 |
| 게시 receipt | `12968038833` / `dockerhub-main-d40cdd0-41037195649-1` | `d02ac1216544671e6716f9e9ca5225e1cfa01060dae2cd8ae4938fdadd58492c` | 2026-11-29 10:02:01 |

다운로드할 ZIP 크기는 각각 약 7.5MB와 1.8KB다. ZIP 해시와 내부 checksums/receipt 해시는 다른 값이므로 둘 다 검증한다. 이름만 검색해 최신 artifact를 고르지 않는다. 고정 ID·소속 run·source SHA·만료·ZIP digest를 먼저 확인하고, bounded extraction에서 경로 탈출·절대경로·중복 경로·symlink·과도한 파일 수/해제 크기를 거부한 뒤 내부 파일의 원래 고정 SHA를 확인한다.

source run은 main의 이미지 빌드 SHA에 속하지만 게시 run은 feature branch의 별도 게시 workflow revision에 속한다. 이미지 서명의 main 조건을 게시 job의 branch와 혼동하지 않는다. 각각 표에 고정한 별도 revision과 run provenance로 확인한다. artifact 삭제·만료·재조회 불일치는 실패로 남기고 로컬 운영 증거 업로드로 대체하지 않는다.

## 구현의 판정·시간 경계

`ci/tempo-warm-case.json`은 공개 이미지와 artifact ID·해시를 고정한다. 최초 실행의 종료 시각은 2026-10-31 04:18:35 UTC이며 시작 시 최소 33분이 남아야 한다. 지연된 PR job은 Docker 실행 전에 거부한다. 이후 재실행에는 새 승인 시간 범위와 명시적 deadline 검토가 필요하다. 운영 데이터·비공개 .local 증거를 입력하는 옵션은 없다.

메타데이터 읽기 실패의 실제 지표는 `tempodb_blocklist_tenant_index_errors_total{tenant=...}`다. `tempodb_blocklist_poll_errors_total{tenant=""}`는 전체 tenant 열거 실패이므로 같은 원인으로 해석하지 않는다. 하네스는 해당 tenant의 새 오류 증가, JSON 파싱 오류 로그, 성공 poll 두 회와 전역 오류 비증가, 무재시작 identity, 20개/133개 전체 의미 일치를 함께 확인한다. 기존 공통 판정기와 테스트도 이 source-backed counter 선택으로 수정했다. 과거 지표 미확보 실행은 이 변경으로 성공 승격하지 않는다.

전체 경로 모의 테스트는 실제 Docker 실행 증거가 아니다. 공개 artifact redirect에서 읽기 토큰 제거, ZIP 경로·중복·symlink 거부, counter reset·다른 tenant·trace 변경·재시작·정리 실패 차단을 검사한다. 저장된 합성 원문과 해시·counter chain은 별도 verdict 모듈이 재계산한다.

## 최초 hosted 실행 결과와 잔여 문제

2026-10-31 run `41165508355`는 서명·게시 run 검증과 합성 writer/closed-block 생성을 통과했으나 정상 reader가 6분 동안 `404 {"metrics":{}}`를 반환해 실패했다. 오류 metadata 주입 단계 이전이며 warm 역이동 증거가 아니다. 소유 fixture 정리는 성공했다. 기존 2분 관측 제한을 6분으로 늘린 것만으로 해결되지 않았다.

소스의 backend block 선택은 span 내용과 별도로 block metadata 시간 경계를 사용한다. 기존 합성 조회 범위가 span 시작 전 1초~후 5초에 한정됐던 결함을 수정해, 생성 시각도 포함하는 최대 1시간의 고정 trace-ID/blocks-only 범위로 조회한다. 이 수정의 실제 원인 해결 여부는 다음 허가 시간 범위에서 새 hosted 실행으로 확인해야 한다. cutoff를 늘리거나 만료 gate를 우회하지 않는다. 최초 case는 계속 기존 종료 시각에 만료된다.

## 2026-10-31 사용자 요청에 따른 재실행

사용자가 기존 실행 기한 연장과 수정한 조회 범위의 실제 재검증을 명시적으로 요청했다. 이번 재실행 case 종료는 2026-10-31 05:11:28 UTC(14:11:28 KST)로 연장한다. 시작 33분 여유·내부 38분 상한·정리 3분·hosted 전용·합성 데이터 경계는 유지한다. 정상 reader의 블록 metadata 시간 경계와 실패 시 실제 metrics도 보존해 빈 결과의 원인을 구분한다. 재실행 성공 전에는 시간 범위 수정이나 warm 역이동이 검증됐다고 주장하지 않는다.
