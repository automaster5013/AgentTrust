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
