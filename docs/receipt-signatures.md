# 릴리스 검증 기록의 서명

## 과거 판정의 오프라인 설명 (v0.170)

`npm.cmd run receipt:inspect -- receipt.json trusted-public.pem`은 독립적으로 신뢰한 Ed25519 공개키로 서명을 확인한 뒤 기록의 판정·사유·실행 ID·근거 해시·비교·관리자 승인 상태의 내부 일관성을 검사한다. Docker 이미지에서도 `node scripts/inspect-receipt.mjs /evidence/receipt.json /evidence/trusted-public.pem`으로 실행할 수 있다. 공개키와 기록만 읽기 전용으로 연결하고 `--network none --read-only --cap-drop ALL --security-opt no-new-privileges`를 사용한다.

JSON 출력은 `historicalDecision`, 사유·변경·회귀 개수와 과거 승인 상태를 제공하며 원문 사유·규칙 이름·검토 의견을 출력하지 않는다. `deploymentAllowed`와 `currentReleasePermissionVerified`는 항상 `false`다. 서명된 해시 참조의 일관성을 확인해도 실행 근거 원문·검토 원문·검토자의 현재 권한은 검증하지 않으므로 근거 원문 파일을 지정하지 않은 기본 검사의 `evidenceBodiesVerified`는 `false`이며, 의견 파일을 지정하지 않은 기본 검사의 `reviewBodyVerified`도 `false`다. 실제 배포 직전에는 서버의 새 릴리스 게이트를 확인해야 한다.

입력은 기존 16 MiB 파일 제한에 더해 깊이 64·방문 항목 100,000개·사유 64개(각 500자)·비교 변경 및 회귀 각 2,000개로 제한한다. 잘못된 서명·모순·형식·입력 파일·공개키는 원문이나 파일 경로를 출력하지 않고 종료 코드 2로 실패한다. 기존 `receipt:verify`는 서명 인증 전용이며 구조 설명 검사를 대체하지 않는다.

v0.171에서는 기록을 선택하기 전에 확인한 ID로 기대 범위를 지정할 수 있다:

```powershell
npm.cmd run receipt:inspect -- receipt.json trusted-public.pem --organization-id <organization-uuid> --project-id <project-uuid> --candidate-run-id <candidate-uuid> --baseline-run-id none
```

조직·프로젝트는 함께 지정해야 한다. 후보 실행은 선택 사항이며, 기준 실행 ID 또는 `none`은 후보 실행을 지정한 경우에만 허용한다. 비교한 기록은 `none` 대신 예상 기준 UUID를 사용한다. 서명이 유효하더라도 기대 ID가 다르면 종료 코드 2로 거부한다. ID를 검사 대상 기록 자체에서 그대로 복사하면 독립적인 범위 확인이 되지 않으므로 사전에 선택한 조직·프로젝트·실행에서 가져온다. UUID 대소문자는 정규화한다. 옵션 중복·부분 입력·알 수 없는 옵션은 파일 읽기 전에 거부한다.

`expectedScopeVerified`, `expectedCandidateVerified`, `expectedBaselineVerified`는 각각 지정해 일치한 기대만 true로 표시한다. 기대를 생략하면 false다. 이 값은 현재 조직 접근 권한·실행 근거 원문·관리자 승인 유효성이나 배포 권한을 증명하지 않는다.

아직 결과가 없는 실행의 정상 차단 기록은 결과 해시가 명시적으로 null일 수 있다. 이 경우 `evidenceReferenceHashesComplete: false`로 설명한다. 필드 누락·잘못된 해시나, 해시가 없는데 통과·비교 가능·승인 유효를 주장하는 기록은 거부한다. 해시 참조가 모두 있어도 근거 원문을 검증했다는 뜻은 아니다.

v0.8의 로컬 setup은 `.local/receipt-signing/private.pem`과 `public.pem`에 Ed25519 키 쌍을 만든다. 기존 키를 재사용하고 서로 일치하지 않으면 setup을 중단한다. private 키는 Git/Docker build에서 제외하며 사용자/SYSTEM 전용 디렉터리 권한을 상속한다. Docker API만 Compose secret으로 읽는다. 워커에는 서명 키를 전달하지 않는다.

새 검증 기록은 기존 schemaVersion 1 artifact와 artifactHash를 유지하고, 별도 signature에 algorithm·keyId·value를 기록한다. 키 ID는 공개키 SPKI DER의 SHA-256이다. 서명 메시지는 고정 도메인 `AgentTrust release receipt v1`과 canonical artifact의 SHA-256으로 구성한다. 서명은 조직·프로젝트·실행·버전 기대값·검증 시간·판정·증거 해시를 모두 결합한다. 기록과 서명은 동일 INSERT에서 저장하며 기존 불변성 트리거로 수정·삭제를 막는다. 중복 요청은 당시 저장한 서명을 그대로 반환한다.

과거 서명 없는 기록을 수정하거나 새 키로 소급 서명하지 않는다. UI는 서명 포함 여부를 표시하며 JSON 저장에 signature를 포함한다. 신뢰 검증은 별도로 수행해야 한다.

```powershell
npm.cmd run receipt:verify -- C:\AgentTrust\.local\ci-smoke-receipt.json C:\AgentTrust\.local\receipt-signing\public.pem
```

이 명령은 네트워크 없이 artifactHash와 Ed25519 서명을 검증한다. 공개키는 운영자가 별도 신뢰 절차로 제공해야 한다. artifact와 함께 받은 임의 공개키를 신뢰하면 발급자를 확인할 수 없다. 인증된 `/v1/receipt-signing-key`는 현재 키의 공개 메타데이터를 제공하지만 그 응답만으로 독립 신뢰가 형성되지는 않는다.

온라인 CI CLI의 `AGENTTRUST_RECEIPT_PUBLIC_KEY_FILE`을 신뢰 공개키 파일 경로로 설정하면 승인 응답의 서명까지 필수 검증한다. 잘못된 키, 서명 없는 응답, 변조된 근거는 exit 2로 실패한다. 이 변수를 생략한 기존 로컬 CI 호출은 해시·요청 일치 검증을 유지한다. 서명 검증을 원하는 runner는 공개키 설정을 반드시 제공한다. 이미 서명 없이 생성된 idempotency key를 재사용하면 새로운 서명이 붙지 않으므로 새 체크 키를 사용한다.

검증 성공은 과거 기록의 발급·무결성을 확인한다. 실제 배포는 매번 현재 버전·유효 시간·평가 상태를 온라인 게이트로 다시 확인해야 한다. 서명된 과거 PASS를 재사용하는 배포 토큰으로 취급하지 않는다.

현재 키는 개발 장치의 파일이며 HSM/KMS·키 철회 목록·자동 회전은 구현되지 않았다. 운영 시 현재 신뢰 공개키와 과거 공개키의 보존·철회 절차, private 키 별도 백업, 복원 후 키 연결을 결정해야 한다. DB backup은 서명 private 키를 포함하지 않는다. private 파일을 임의 삭제하거나 기존 public.pem을 덮어쓰지 않는다.

암호 API는 [Node.js crypto 문서](https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html)를 따른다.

## 오프라인 파일 읽기 제한 — v0.61

`receipt:verify`는 파일을 스트림으로 읽고 최대 16 MiB까지 허용한다. 온라인 게이트 응답의 8 MiB 제한과 들여쓰기된 JSON 저장을 고려해 기존 512 KiB 제한을 확대했다. 한도를 넘으면 읽기를 중단하고, 손상된 UTF-8·잘못된 JSON·서명 변조는 종료 코드 2로 거절한다. 임의 크기의 파일을 지원하지 않으며 큰 기록은 이 한도 안에서 저장해야 한다. 성공 결과도 `historicalEvidenceOnly: true`인 과거 증거이며 현재 배포 허용을 뜻하지 않는다.

## CI 저장 크기와 오프라인 호환성 — v0.62

CI 기록 저장과 오프라인 읽기는 같은 16 MiB UTF-8 바이트 한도를 사용한다. 들여쓰기한 JSON이 한도를 넘으면 같은 artifact·해시·서명을 압축 JSON으로 저장한다. 압축 후에도 초과하면 파일을 만들기 전에 거절하고 CLI는 종료 코드 2를 반환한다. 기존 파일은 덮어쓰지 않는다. 줄바꿈과 들여쓰기 변경은 canonical artifact 해시나 서명 내용을 바꾸지 않는다. 저장 성공은 서명 검증이나 현재 배포 권한을 대신하지 않는다.

## 신뢰 공개키 입력 — v0.63

온라인 CI와 오프라인 `receipt:verify`는 같은 검사로 SPKI PEM 형식의 Ed25519 공개키만 허용한다. private key를 넣어 공개키를 자동 추출하는 동작은 허용하지 않는다. 빈 값·손상된 PEM·다른 알고리즘도 거절한다. 오프라인 오류는 키 내용을 출력하지 않고 종료 코드 2를 반환한다. 기존 서명 키 생성과 artifact·서명 형식은 유지한다. 공개키의 출처 신뢰는 운영자가 별도로 확보해야 한다.

## 단일 공개키 파일과 읽기 한도 — v0.99

CI·오프라인 검증은 1 KiB 이하의 단일 SPKI 공개키 파일을 엄격한 UTF-8로 읽는다. 다른 PEM이나 원문을 이어 붙인 파일·잘못된 인코딩·디렉터리·private key를 거절한다. 앞뒤 ASCII 공백과 CRLF는 한도 안에서 허용한다. CI는 이 검사에 성공하기 전에 인증 요청을 시작하지 않는다. 오류 안내는 파일·키 원문을 포함하지 않으며 기존 종료 코드 2를 유지한다.

시연·배포 준비 검사도 v0.106부터 같은 공개키 reader를 사용한다. 기존 개인키 파일은 키 쌍 확인에만 사용하고 public.pem에 개인키를 넣은 설정은 거절한다.

## 원래 검토 의견의 오프라인 결합 v0.172

```powershell
npm.cmd run receipt:inspect -- receipt.json trusted-public.pem --review-file original-review.json
```

기대 조직·프로젝트·후보·기준 옵션과 함께 사용할 수 있다. 서명과 기대 범위를 먼저 인증한 뒤 의견 파일을 최대 64 KiB의 엄격한 UTF-8 JSON으로 읽는다. 원본 파일은 바꾸지 않는다. 의견 ID·본문 해시·조직·프로젝트·실행·근거 해시가 서명된 참조와 같아야 하며 의견 판정·시각·본문 필드도 대조한다. 의견 해시를 다시 계산해도 서명된 참조가 다르면 거부한다. 원래 검토가 없는 기록에 의견을 붙이거나 의견 파일을 중복 지정하면 실패한다.

성공 시 `reviewBodyVerified: true`, `linkedReviewId`, `linkedReviewHash`만 추가하고 의견·검토자 원문은 출력하지 않는다. 의견 자체가 별도로 서명된 것은 아니다. 독립 신뢰 공개키로 인증한 기록의 참조를 통해 의견을 결합하며 `currentReviewerAuthorityVerified`, `currentReleasePermissionVerified`, `deploymentAllowed`는 항상 false다. 과거 승인 만료·반려·권한 무효 기록의 원래 의견도 검증할 수 있으나 현재 승인으로 되돌리지 않는다. 파일을 생략하면 기존 동작과 `reviewBodyVerified: false`를 유지한다.

Docker 검사에는 공개키·기록·의견 세 파일만 읽기 전용으로 연결하고 네트워크를 끈다. 비밀키·접근 키나 전체 작업 폴더를 연결하지 않는다. 실패 시 종료 코드 2와 안전한 오류만 반환한다. 의견 파일은 기밀일 수 있으므로 보관과 전달 대상은 운영자가 정한다.

## 스냅샷과 평가 결과 원문의 오프라인 결합 v0.173

```powershell
npm.cmd run receipt:inspect -- receipt.json trusted-public.pem --candidate-evidence-file candidate-run.json --baseline-evidence-file baseline-run.json
```

`/v1/runs/<id>`에서 내보낸 평가 JSON의 `snapshot`과 `{results, gate}`를 각각 canonical SHA-256으로 계산하고, 독립 신뢰 공개키로 인증한 기록의 근거 참조와 대조한다. 파일의 실행·조직·프로젝트 ID 및 저장 해시도 참조와 같아야 한다. 비교한 기록에는 두 원문이 모두 필요하며 기준 없는 기록에는 후보 원문만 지정한다. 기준만 지정하거나 중복·부분 옵션을 지정하면 거부한다. 해시를 다시 계산해도 서명된 참조와 다른 본문은 통과하지 못한다. 아직 결과 해시가 없는 기록의 원문 결합은 완료할 수 없다.

`evidenceBodiesVerified`, `candidateEvidenceVerified`, `baselineEvidenceVerified`는 해당 서명된 본문 해시의 일치를 설명한다. `evidenceVerificationScope`는 `signed-snapshot-and-result-bodies`, `evidenceMetadataAuthenticated`는 false다. 실행 상태·요약·시각·시도 수 등 해시 밖의 메타데이터는 인증하지 않으며 원문을 재평가하거나 에이전트를 실행하지 않는다. 과거 배포 판정은 서명 기록의 값으로만 설명하고 현재 배포 허용은 항상 false다. 원문을 지정하지 않으면 기존 검사와 `evidenceBodiesVerified: false`를 유지한다.

기대 범위와 `--review-file` 옵션을 함께 지정할 수 있다. 서명·기대 범위를 확인한 뒤 원문 파일을 각각 최대 16 MiB의 엄격한 UTF-8 JSON으로 읽으며 후보·기준 원문을 묶어 깊이 64·항목 100,000개 제한을 적용한다. 실패는 종료 코드 2와 안전한 오류만 출력한다. 원문 파일의 입력·출력·주석은 요약에 포함하지 않는다. 원문은 기밀일 수 있으므로 공개 저장소에 올리지 않는다. Docker에는 해당 원문·의견·기록·신뢰 공개키만 읽기 전용으로 연결하고 네트워크를 끈다.
