# 오프라인 릴리스 감사 자료와 보고서

서명 기록 6개와 당시 승인·반려 의견 2개를 보존하고, 독립 신뢰 공개키로 오프라인 재검증한다. 합성 시연 자료이며 현재 배포 권한이나 실제 고객 배포 결과를 나타내지 않는다.

```powershell
Set-Location C:\AgentTrust
npm.cmd run demo:evidence -- --with-reviews --with-report
```

명령은 자체 데모와 viewer 세션의 정리·로그아웃을 완료한 뒤 원래 검토를 포함한 새 자료와 HTML을 만든다. 마지막 JSON의 `directory`, `manifestSha256`, `auditReport.path`를 확인한다. 자료는 `.local`에 남으며 Git에 업로드하지 않는다. `--with-report`는 `--with-reviews`와 함께 사용한다.

이미 저장한 자료를 다시 검증하거나 보고서로 만들 수 있다.

```powershell
npm.cmd run demo:evidence:verify -- .local/portfolio-evidence-<UUID> .local/receipt-signing/public.pem <manifestSha256>
npm.cmd run demo:evidence:report -- .local/portfolio-evidence-<UUID> .local/receipt-signing/public.pem .local/new-audit-report.html <manifestSha256>
```

공개키는 자료와 별도로 신뢰한 키를 지정한다. 로컬 시연 공개키 경로는 위 예시와 같지만 타인의 자료를 검증할 때 그 자료가 함께 제공한 키를 자동으로 신뢰하면 안 된다. 목록 SHA-256 일치는 전달한 값과의 일치이며 목록의 독립 서명이나 전달 경로의 신뢰를 증명하지 않는다.

| 자료 | 확인 내용 |
| --- | --- |
| `receipt-1.json`~`receipt-6.json` | 고정된 정상·회귀·근거 누락·승인 전/후·반려 판정과 Ed25519 서명 |
| `review-1.json`, `review-2.json` | 서명 artifact의 원래 검토 ID·해시에 결합된 승인·반려 의견 |
| `manifest.json` | 정확한 파일 목록·파일 SHA-256·조직/프로젝트·실행 참조 |
| 별도 HTML | 검증한 원본에서 생성한 읽기용 사본. HTML 자체는 서명되지 않음 |

새 schemaVersion 2 자료는 정확히 아홉 일반 파일만 허용한다. schemaVersion 1의 기존 일곱 파일 자료도 계속 읽으며 보고서에는 의견 미포함을 표시한다. 보고서 파일을 원본 폴더에 넣으면 목록이 바뀌므로 도구가 해당 출력을 거절한다. 디렉터리 별칭으로 같은 폴더를 지정해도 거절한다. 출력 경로는 원본 밖의 새 `.html` 파일이어야 하며 기존 파일을 덮어쓰지 않는다.

보고서는 당시 판정과 차단 이유, 후보/기준 실행, 고정 버전, 스냅샷/결과/기록 해시, 서명 키 ID, 원래 의견을 표시한다. 의견과 이유는 텍스트로 이스케이프한다. 긴 차단 이유는 보고서에서 최대 4,096자만 표시하고 원본 확인 안내를 붙인다. 원본 파일은 자르거나 변경하지 않는다. 스크립트·외부 자원·원격 전송은 포함하지 않는다. 접근 키·서명 비밀키·평가 원문 입출력은 내보내지 않는다. 의견과 실행 식별자 자체는 기밀일 수 있으므로 자료 공유 범위는 운영자가 정한다.

최종 배포 직전에는 현재 키·역할·근거·유효 시간·검토 상태를 확인하는 `release:gate`를 다시 실행해야 한다. 과거 승인 의견이나 유효한 과거 서명은 현재 승인을 복원하지 않는다. 오류 시 보고서 CLI는 고정 안내와 종료 코드 2를 반환하며 원문 의견·파일 내용·오류 스택을 출력하지 않는다.
