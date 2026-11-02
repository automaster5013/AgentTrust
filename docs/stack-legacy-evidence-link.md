# 4310 서명 기록과 4320 좌표의 읽기 전용 연결 사전검사

2026-11-01 소스 구현. 기존 자료를 새 DB에 가져오거나 현재 배포 권한으로 전환하는 기능이 아니다. 먼저 **원본 파일의 정확한 바이트·과거 서명·출처 조직/프로젝트**를 보존한 상태에서, 별도로 기대한 4320 대상 좌표와 연결 설명자가 일치하는지 오프라인으로 검사한다. 실제 4310 설치·기존 DB·개인키·현재 사용자 세션에는 연결하지 않는다.

## 입력과 독립 기대값

```text
node scripts/stack-legacy-receipt-link.mjs source-receipt.json trusted-public.pem mapping.json --target-organization-id <4320-org-uuid> --target-project-id <4320-project-uuid> --mapping-sha256 <independent-mapping-file-sha256>
```

세 파일은 읽기만 한다. 평가를 실행하거나 네트워크·DB·현재 게이트를 호출하지 않고 결과 JSON을 stdout으로 반환한다. 기존 파일을 덮어쓰는 출력 옵션은 없다. 키는 별도 절차로 신뢰한 단일 Ed25519 SPKI 공개키여야 하며, 기록과 함께 받은 임의 키나 개인키에서 신뢰를 자동으로 만들지 않는다. 1KiB 이하 공개키·8KiB 이하 연결 설명자·기존 16MiB 이하 receipt 한도를 적용한다. 일반 파일만 허용하고 최종 파일 symlink·디렉터리·빈 파일·초과 입력·손상 UTF-8은 거부한다.

`mapping.json`은 다음 11개 필드만 허용한다. UUID와 SHA-256은 소문자 canonical 형식이다.

| 필드 | 의미 |
|---|---|
| `schemaVersion` | 정수 `1` |
| `sourcePlatform` / `targetPlatform` | `agenttrust-4310` / `agenttrust-4320` |
| `sourceOrganizationId` / `sourceProjectId` | 과거 서명 artifact의 기대 조직·프로젝트 |
| `targetOrganizationId` / `targetProjectId` | CLI에서 별도로 지정한 4320 기대 좌표 |
| `sourceReceiptId` | 기대하는 원래 서명 기록 ID |
| `sourceArtifactHash` | 기존 canonical artifact의 SHA-256 |
| `sourceReceiptBytesSha256` | 들여쓰기·줄바꿈을 포함한 원래 receipt 파일 바이트의 SHA-256 |
| `sourceSigningKeyId` | 독립 공개키의 SPKI DER SHA-256, 기존 서명 key ID |

설명자 자체는 서명되지 않는다. `--mapping-sha256`은 별도 경로로 전달받아 기대한 **설명자 파일 원본 바이트**의 지문이다. 파일에서 방금 계산한 값을 그대로 기대값으로 넣는 것만으로 운영자 승인이나 출처 신뢰가 생기지는 않는다. 대상 조직·프로젝트의 실제 권한, 설명자 승인·현재 키 폐기/신뢰 정책은 이 도구가 확인하지 않는다.

## 확인 범위와 보존

기존 `packages/receipts/inspection.js`의 Ed25519 도메인·artifact hash·서명·v1 구조·판정 일관성 검사를 그대로 재사용한다. 원본을 새 형식으로 재직렬화하거나 서명하지 않는다. raw 파일 지문과 canonical artifact 서명은 구분하며, 같은 artifact라도 줄바꿈이 달라진 파일은 기대한 원본 바이트와 같다고 처리하지 않는다. 출처 조직/프로젝트·기록 ID·artifact hash·공개키 ID도 각각 대조한다. 과거 비서명 자료는 보존하지만 이 사전검사의 서명 성공 대상으로 승격하지 않는다.

성공 출력에는 원래 기록 ID·hash/key ID·과거 판정과 확인 범위만 포함한다. 사유·원래 검토 의견·모델 입력/출력·키 원문·파일 경로는 출력하지 않는다. 실패는 안전한 고정 안내와 종료 코드 2이며 부분 성공 JSON을 내보내지 않는다.

`historicalEvidenceOnly=true`이며 다음은 계속 false다: `targetRecordImported`, `sourceRecordRewritten`, `actorMappingPerformed`, `mappingCryptographicallySigned`, `mappingOperatorApprovalVerified`, `sourceCurrentTrustPolicyVerified`, `targetTenantAuthorityVerified`, `currentReviewerAuthorityVerified`, `currentReleasePermissionVerified`, `deploymentAllowed`. 별도 평가/검토 원문을 받지 않으므로 `evidenceBodiesVerified`·`reviewBodyVerified`도 false다. 과거 PASS는 현재 Java 게이트나 배포 토큰이 아니다.

주체·역할·계정·세션·CI 키를 같은 UUID라는 이유로 승계하지 않는다. 그런 필드를 설명자에 추가하면 거부한다. 원래 검토 주체를 이전하려면 서명된 참조에 결합한 원문 검토 검증과 별도의 운영자 승인 주체 mapping·현재 대상 권한 검사가 필요하며 이번 도구는 이를 구현하지 않는다.

## 검증 상태와 남은 단계

합성 Ed25519 통과/차단 자료로 원본 바이트·독립 설명자 지문·출처/대상·키·서명 치환·재계산 hash·부적절한 권한 필드·크기/UTF-8·일반 파일 검사를 검증한다. 실제 CLI의 성공/실패·출력 비밀 부재·세 입력 파일 보존을 검사하며, Windows junction 경로에서도 CLI가 실제 실행되도록 entry 파일의 realpath를 대조한다. 기존 서명/검사 회귀와 함께 20개 로컬 테스트가 통과했다. 원격 결과는 해당 revision의 CI를 따른다.

현재는 자료 연결의 사전검사 계약과 도구다. 실제 기존 자료 연결·전체 데이터 이전·Java의 인증된 import API·불변 연결 목록·운영자 승인/폐기 정책·현재 대상 사용자 권한·브라우저 수용은 미구현이다. 실제 운영 자료로 도구를 실행하거나 서명 키를 바꾸거나 기존 자료/DB를 수정하지 않았다.


2026-11-01 원격 확인: 소스 `d5de860925f1b27a59f5aba687c8a6a8bb2a2647`의 [Validate and deliver 41292563858](https://github.com/automaster5013/AgentTrust/actions/runs/41292563858)에서 Node 24/Linux의 실제 CLI·서명/원본 바이트 보존·심볼릭 링크 입력 거부 검사가 통과했다. 같은 revision의 [통합 CI 41292563839](https://github.com/automaster5013/AgentTrust/actions/runs/41292563839)도 통과했다. 이 결과는 합성 서명 fixture와 후보 스택에 한정한다. 실제 기존 운영 기록을 도구에 입력하거나 대상 DB에 연결/가져온 것은 아니다.


2026-11-02 경계 보완: 일반 파일의 `lstat`과 `open` 사이에 입력이 FIFO로 교체되면 이전의 read-only open은 파일 종류/신원 검사에 도달하기 전에 대기할 수 있었다. 지원 플랫폼에서 `O_NONBLOCK`을 함께 지정해 열린 핸들의 종류·신원을 즉시 거부하도록 했다. Windows에서는 해당 상수가 없어 기존 일반 파일 경로가 그대로 동작한다. Linux 회귀는 자체 임시 입력만 실제 FIFO로 바꾸며, 비차단 플래그를 제거한 별도 자식은 시간 제한으로 종료되는 선행 동작을 확인하고 수정된 읽기는 거부 후 정상 종료해야 한다. 실제 기존 자료·운영 서비스·서명 키에는 접근하지 않는다. 새 원격 검사 결과는 해당 소스 CI에서 확인한다.


## 여러 자료의 일괄 읽기 전용 사전검사

2026-11-02 후속 소스는 동일 입력 폴더의 기존 서명 receipt와 연결 설명자를 1~20건씩 대조하는 CLI를 추가한다. 단일 자료 도구의 기존 Ed25519·원본 바이트·출처·대상·독립 mapping 지문 검증을 그대로 사용한다. 원본을 쓰거나 DB에 가져오지 않는다. 전체 목록이 검증된 뒤에만 결과 JSON 하나를 출력하며, 뒤쪽 자료가 실패해도 앞쪽 자료의 부분 성공은 출력하지 않는다.

```text
node scripts/stack-legacy-catalogue.mjs catalogue.json --target-organization-id <4320-org-uuid> --target-project-id <4320-project-uuid> --catalogue-sha256 <independent-catalogue-file-sha256> [--max-input-bytes <positive-decimal-byte-limit>]
```

`catalogue.json`은 다음 구조의 UTF-8 JSON이다. 다른 필드와 중복 옵션은 거부한다.

```json
{
  "schemaVersion": 1,
  "kind": "legacy-receipt-link-catalogue",
  "entries": [
    {
      "receiptFile": "receipt-1.json",
      "trustedKeyFile": "trusted-public.pem",
      "mappingFile": "mapping-1.json",
      "mappingSha256": "<independently-expected-mapping-file-sha256>"
    }
  ]
}
```

목록 파일 자체는 최대 64KiB이고, 실제 읽은 목록·mapping·공개키·receipt 바이트 합계는 기본 최대 64MiB다. 공유 공개키 파일을 여러 번 읽으면 그 바이트도 매번 합산한다. `--max-input-bytes`는 이 상한 이하의 양의 정수로만 줄일 수 있다. 각 receipt 16MiB·mapping 8KiB·공개키 1KiB의 기존 개별 상한도 유지한다. 입력은 순서대로 검증하며 총량을 넘기는 파일은 허용하지 않는다.

각 참조는 같은 폴더의 128자 이하 ASCII 파일 이름만 허용한다. 하위 경로·상위 이동·절대 경로·점으로 시작하는 이름·Windows 장치 별칭·끝의 점은 거부한다. 최종 심볼릭 링크·일반 파일 여부·열린 파일 신원 검사는 공유하는 기존 bounded reader를 사용한다. 읽기 전후 폴더 신원과 지정 경로도 대조한다. 신뢰한 입력 폴더를 동시에 수정하지 않는 조건에서 사용하며, 여러 파일에 대한 원자적 filesystem snapshot이나 임의 경로를 격리하는 sandbox를 제공하지 않는다.

`--catalogue-sha256`과 각 `mappingSha256`, 신뢰 공개키 및 대상 좌표는 별도로 기대한 값이어야 한다. 목록 파일에서 자동으로 기대값을 만들거나 대상 좌표를 추론하지 않는다. 원래 출처 조직/프로젝트/receipt ID가 같은 기록의 중복은 거부하고, 서로 다른 출처 조직의 같은 receipt ID는 각 서명·mapping이 따로 검증돼야 한다. 모든 mapping은 CLI에서 지정한 동일 대상 좌표와 일치해야 한다.

성공 결과의 `records`는 단일 자료 도구의 제한된 검증 메타데이터와 각각 검증된 원래 출처 좌표(`sourceCoordinates`)다. 원래 사유·검토 의견·모델 입출력·공개키 원문·입력 파일 경로는 출력하지 않는다. 목록 지문 일치도 운영자 승인이나 현재 키 신뢰를 대신하지 않는다. `catalogueCryptographicallySigned`, `catalogueOperatorApprovalVerified`, `sourceCurrentTrustPolicyVerified`, `targetTenantAuthorityVerified`, `actorMappingPerformed`, `targetRecordImported`, `currentReviewerAuthorityVerified`, `currentReleasePermissionVerified`, `deploymentAllowed`는 계속 false다. 실제 자료 import·주체/권한 승계·운영 연결 API·현재 배포 권한은 미구현이다.

Windows의 실제 CLI·원본 보존·독립 pin/좌표·읽기 총량·중복 범위·부분 출력 부재·실제 입력 폴더 교체 거부 검사를 확인했다. Linux 전용 심볼릭 링크와 공유 reader의 기존 FIFO 교체 회귀를 포함한 원격 결과는 새 소스 CI에서 확인한다. 운영 자료나 서비스에는 이 도구를 실행하지 않았다.


## 목록 v2의 서명 참조 본문 검증

목록 `schemaVersion: 2`는 각 항목의 기존 네 필드에 `bodyFile`과 독립적으로 기대한 `bodySha256` 두 필드를 필수로 추가한다. 모든 항목이 본문 모드여야 한다. CLI 인자·대상 좌표·목록 지문과 기존 v1의 메타데이터 전용 형식은 유지한다.

`bodyFile`은 동일 입력 폴더의 일반 파일이며 다음 봉투를 사용한다.

```json
{
  "schemaVersion": 1,
  "kind": "legacy-receipt-source-bodies",
  "bodies": {
    "candidate": "<original run object>",
    "baseline": "<original baseline run object, only when referenced>"
  },
  "review": "<original review object, only when referenced>"
}
```

위 객체 자리에는 원래 실행/검토 JSON 객체를 넣는다. 비교 기준이 없는 기록에는 `baseline` 필드를 넣지 않는다. 원래 receipt에 review hash가 있으면 `review` 본문이 필수이고, 없는 검토를 임의로 추가하지 않는다. 본문 봉투도 최대 16MiB이며 원본 바이트 SHA-256을 먼저 확인한 뒤 같은 총 읽기 상한에 합산한다. 재직렬화로 의미가 같아도 원본 바이트 지문이 다르면 거부한다.

기존 `inspectHistoricalReceipt`의 엄격한 본문 검증을 재사용한다. 원래 서명·출처 좌표·스냅샷/결과 해시·필수 후보/비교 기준 쌍을 확인하고, 서명된 내용에서 버전·규칙 근거·판정과 비교 결과를 다시 대조한다. 실행 객체의 비서명 상태·통계·버전 주석은 판정 근거로 사용하지 않는다. 본문의 원래 조직/프로젝트를 대상 좌표로 덮어쓰지 않는다. 참조된 검토 본문은 원래 signed review ID/hash·범위·실행 근거·기록 시각과 결합해야 한다.

성공한 v2 출력은 `bodyEvidenceMode=linked-source-bodies`와 `bodyEvidenceEntriesVerified`를 포함한다. 각 항목의 `evidenceBodiesVerified`·`evidenceStructuresVerified`와 해당 후보/비교 기준 검증 표시가 실제 검증에 따라 true가 된다. `reviewBodyExpected`와 `reviewBodyVerified`는 구분한다. 과거 승인이 missing인 기록은 검토 검증 false와 과거 차단 상태를 유지한다. 결과 해시 등 필요한 서명 참조가 없는 자료는 본문 모드의 검증 완료 대상으로 처리하지 않으며, 기존 v1 메타데이터 전용 검사 범위를 사용할 수 있다.

본문·검토 의견·원래 검토자 ID·입력 파일 경로는 출력하지 않는다. `evidenceMetadataAuthenticated=false`, `unsignedMetadataUsedForStructure=false`, `agentReexecuted=false`다. 과거 승인/반려/만료 자료의 본문이 맞더라도 현재 검토자 권한·키 신뢰 정책·현재 배포 허용·자료 import·주체/역할 승계 표시를 true로 바꾸지 않는다. 원래 모델을 실행하거나 외부 모델 API를 호출하지 않는다.

Windows의 실제 v2 CLI·원본 보존·후보/비교 기준·서명은 맞지만 규칙/비교가 모순되는 자료·출처 좌표 덮어쓰기·검토 본문 누락/치환·본문 raw pin·총 읽기 상한·뒤쪽 실패의 부분 출력 부재를 합성 자료로 검증한다. Linux 심볼릭 링크와 전체 회귀의 원격 결과는 해당 소스 CI를 따른다. 실제 기존 운영 자료로 이 검사를 실행하거나 운영 데이터를 가져온 상태는 아니다.

### 파일 신원 비교의 정수 정밀도

2026-11-02 후속 보완: 공통 reader의 경로 `lstat`과 열린 핸들 `stat` 모두 `bigint` 결과를 사용한다. 큰 device/inode 식별자를 Number로 변환하면 서로 다른 두 정수가 같은 값으로 반올림될 수 있어, 열린 파일의 신원 변경을 놓치는 합성 사례를 확인했다. 바이트 제한도 같은 정수 형식으로 비교하며 일반 파일·심볼릭 링크·비차단 open·열린 핸들 종료 조건은 유지한다.

격리 자식에서 Number 범위를 넘는 서로 다른 device와 inode를 각각 주입하면 기존 reader는 신원 차이를 놓치고 새 reader는 읽기 전에 거부한다. 동일 신원의 정상 입력은 계속 읽히고 모든 경로에서 핸들을 닫는다. 실제 운영 파일을 교체한 검사가 아니다. Windows의 관련 42개 검사 중 39개 통과·Linux 전용 3개 건너뜀을 확인했으며, Linux FIFO·심볼릭 링크와 실제 CLI 회귀의 원격 결과는 해당 revision의 CI에서 별도로 확인한다. 서명·원본 바이트·독립 pin·현재 권한 불승계 계약은 변경하지 않는다.

## 원본 재검증에 결합한 오프라인 HTML 보고서

`stack-legacy-catalogue-report.mjs`는 기존 JSON CLI와 같은 필수 인자를 받아, 원본 목록·기록·연결 설명자·공개키 및 선택된 v2 본문을 모두 검증한 뒤 HTML 문서 하나를 표준 출력한다.

```text
node scripts/stack-legacy-catalogue-report.mjs catalogue.json --target-organization-id <4320-org-uuid> --target-project-id <4320-project-uuid> --catalogue-sha256 <independent-catalogue-file-sha256> [--max-input-bytes <positive-decimal-byte-limit>]
```

검증되지 않은 JSON 요약을 보고서의 입력 증거로 받지 않는다. 같은 파일/총량 제한·독립 기대값·원본 출처·서명 검증을 재사용하며, 뒤쪽 자료가 실패해도 HTML 일부를 출력하지 않는다. 기존 JSON CLI의 형식은 유지한다. 출력 보관 경로는 사용자가 정하며 CLI 자체가 원본 파일을 쓰거나 운영 서비스에 접속하지 않는다.

표에는 원래 조직/프로젝트/기록 식별자, 과거 판정, 본문·참조 검토의 검증 범위, 원본/연결 설명자/본문 봉투의 바이트 지문과 원래 키 지문만 표시한다. v1의 본문 미검증과 v2의 본문·구조 검증을 구분한다. 모델 입출력·검토 의견·검토자·공개키 원문·원본 경로를 넣지 않는다. 보고서의 조직·프로젝트·기록 식별자와 지문도 공유 전 공개 범위를 확인해야 한다.

문서 상단에 현재 배포 권한과 자료 가져오기가 없음을 표시한다. 보고서는 새 서명·운영자 승인이나 변조 방지 봉투가 아니며, 복사된 HTML 자체를 현재 신뢰 증거로 소비하지 않는다. 원본과 독립 pin으로 CLI를 재실행해야 한다. 목록 서명·현재 키 신뢰·대상 권한·주체/역할 승계·현재 검토자/릴리스 권한은 계속 미검증이다.

외부 자원·스크립트·폼·링크 없이 정적 HTML과 인라인 스타일만 사용하며 CSP로 네트워크/스크립트·기본 URL·폼 전송을 제한한다. 좁은 화면은 키보드 초점이 가능한 표 내부에서 좌우 이동한다. Windows에서 원본 보존·실제 CLI 전체/실패 출력·권한 경계·v2 본문/검토 비노출을 포함한 관련 46개 중 43개 통과·Linux 전용 3개 건너뜀을 확인했다. 합성 파일 생성과 HTML 렌더링은 로컬 확인했고, 네 화면 크기(320/390/768/1440)의 브라우저 레이아웃·키보드·외부 요청 부재는 Console UX CI의 별도 결과로 확인한다. 운영 자료를 이 보고서에 입력하거나 공개 CI로 보내지 않았다.
