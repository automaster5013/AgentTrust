# 릴리스 검증 기록의 서명

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
