# 4310 영상·자막 검토 도구

2026-10-28 기준. 실제 영상은 제출처 규정에 맞춰 사용자가 추후 제작한다. 실제 영상·자막·화면 및 음성 노출 검토는 **미완료·보류**다. 이 도구와 합성 검증 결과는 실제 촬영·검토 완료의 증거가 아니다. 현재 녹화·자원 입장·자동화는 자동 재개하지 않는다.

## 구현된 범위

| 도구 | 동작 | 남는 제한 |
|---|---|---|
| [로컬 도구 준비](../scripts/setup-portfolio-media-tools.py) | 고정된 FFmpeg·FFprobe 배포본의 SHA-256을 검증하고 프로젝트 내부에 설치 | Windows용 tar·compact 필요. 시스템 PATH·서비스를 변경하지 않음 |
| [영상 사전 검사](../scripts/portfolio-media-review.py) | 소스 해시·길이·영상/음성 트랙 확인, SRT 시점·겹침·읽기 속도·민감정보 패턴 검사 | 자막의 의미·발화와 실제 화면의 일치 검토는 별도 |
| [프레임 처리](../scripts/portfolio_media_tools.py) | 일정 간격과 자막 중간 시점의 프레임 추출, 로컬 도구 해시 확인 | 최대 10분 입력·80개 표본. 짧게 노출되는 정보는 누락 가능 |
| [Windows OCR](../scripts/portfolio-frame-ocr.ps1) | 설치된 Windows OCR로 표본 화면의 비밀번호·토큰·이메일·기록 ID 패턴을 종류·위치로 보고 | OCR 원문을 보고서에 쓰지 않음. 언어·해상도·인식 오류로 탐지 누락 가능 |
| [녹화 도구](../scripts/portfolio-capture.py) | 명시적으로 실행할 때 한 개의 제품 창만 최대 4분 녹화, Enter로 조기 종료, 지정 폴더 저장 | 실제 창 녹화는 미검증. 무음 녹화이며 로그인·화면 이동은 자동화하지 않음 |
| [PowerShell 진입점](../scripts/review-portfolio-video.ps1) | 프레임·선택 OCR·자막 검사를 한 명령으로 실행 | 검사 결과가 좋아도 자동 승인하지 않음 |

FFmpeg는 [공식 다운로드 안내](https://ffmpeg.org/download.html)에 연결된 [Gyan Windows 배포본](https://www.gyan.dev/ffmpeg/builds/)의 고정 버전과 체크섬을 사용한다. Windows OCR은 [Microsoft OcrEngine](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.trycreatefromuserprofilelanguages)의 로컬 엔진을 사용한다. 바이너리·실제 영상·프레임·원시 OCR 결과는 GitHub 업로드나 문서 제출 목록에 포함하지 않는다.

## 재현 가능한 검사

Python 3.10 이상이 필요하다. 아래 검사는 합성 입력만 사용하며 촬영·로그인·서비스 접근·유료 호출을 하지 않는다.

```powershell
Set-Location 'C:\AgentTrust'
python -m unittest discover -s scripts -p "test_portfolio_media*.py"
python scripts/test_portfolio_submission_audit.py
python scripts/portfolio-submission-audit.py
```

Windows에서 실제 FFmpeg·FFprobe와 설치된 한국어 OCR을 사용한 4초 합성 영상 처리도 확인했다. 길이·음성 트랙·프레임 두 개, 의도적으로 넣은 민감정보 형식 탐지, 미승인 자막 초안과 검토표·마스킹 후보 생성이 동작했다. 이 자료는 합성 시험이며 4310 제품의 실제 화면·발화·업무 흐름 검증이 아니다.

현재 로컬 검증은 미디어 경계 검사 24개·문서 검사 도구의 제어 검사 11개와 문서 14개/링크 364개가 통과했다. 배포 사전검사 보완은 격리·백업 합성 검사 4개가 통과했으며 실행 제품이나 실제 DB를 변경하지 않았다. 이후 GitHub CI 결과는 새 커밋의 실행 상태를 따로 확인한다.

## 나중에 영상이 준비되면

먼저 제출처의 영상 필수 여부·길이·형식·해상도·음성·자막·정보 공개 규정을 확인한다. 실제 촬영 재개는 사용자의 명시적 요청과 기존 가드·복구 예산·신선한 3.5GiB 메모리/28,301,660,260바이트 디스크/연속 900초 입장 조건을 전제로 한다. 과거 입장·이전 부팅의 기록을 재사용하지 않는다. 현재 저장소의 일반적인 소스 복제만으로 비공개 로컬 가드·원장이 준비되는 것은 아니다.

[녹화 진입점](../scripts/start-portfolio-capture.ps1)은 기본 실행 시 준비 확인만 한다. `-Record`는 실제 녹화를 명시적으로 선택하며, 최근 기존 입장 기록·보존된 런타임 가드·20개 정상 서비스·로그인 후 사용자 시작 조작을 요구한다. 이 도구는 자원 입장을 새로 시작하지 않고, 실패를 자동 재시도하지 않는다. 로그인과 비밀 입력은 녹화 전에 마치고 기존 조회자로 기존 기록만 보여준다.

Windows PowerShell 진입점은 기본적으로 현재 사용자의 LocalAppData에 있는 Python 3.14 고정 경로를 사용한다. 다른 Python 설치는 `-PythonPath`로 지정한다. 어떤 경우에도 실제 작업 위치는 `C:\AgentTrust`로 유지한다.

영상이 이미 있으면 다음과 같이 검사할 수 있다. 예시 파일명은 실제 영상이 있다는 뜻이 아니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/review-portfolio-video.ps1 -Video 'C:\AgentTrust\.local\portfolio-4310-focused-review-20261027\video-inbox\actual-demo.mp4' -Captions 'C:\AgentTrust\.local\portfolio-4310-focused-review-20261027\video-inbox\actual-demo.srt' -Ocr
```

자막 대신 `-Timeline`으로 JSON 관찰 시점표를 입력할 수 있다. `source`는 `observed-video-timeline`, `videoSha256`은 정확한 원본 해시, `cues`는 실제 관찰한 `start`·`end`·`text` 목록이어야 한다. 해시 연결은 사용자의 관찰 선언을 결합하는 장치이며 실제 관찰의 진위를 자동 증명하지 않는다. 민감정보 패턴이나 자막 형식 문제가 있으면 새 SRT 초안을 저장하지 않는다.

## 출력과 판정

출력은 프로젝트의 비공개 로컬 폴더에 새로 생성한다. 기존 영상·제출 ZIP을 덮어쓰지 않는다.

- `review.json`: 해시·길이·트랙·표본 OCR 결과와 차단 항목. 실제 제품 출처·전체 화면/음성 검토·자막 의미 일치는 별도 상태다.
- `review-plan.tsv`: 자막 시점·대응 프레임·의심 정보 종류를 대조하는 검토표다.
- `review-decisions-template.json`: 원본·자막·검토표 해시에 연결된 수동 검토 기록 양식이다. 승인 증명서가 아니다.
- `masking-candidates.json`: 노출 의심 위치 목록이다. 실제 노출 시간 범위를 확정하거나 마스킹을 적용한 결과가 아니다.
- `captions-unapproved.srt`: 조건을 통과한 관찰 시점표로 만든 미승인 초안이다.

사전 검사 도구는 전체 실제 검토가 남아 있으므로 종료 코드 2와 `accepted=false`, `packageComplete=false`를 유지한다. 녹화 도구의 저장 성공도 영상 검토 완료를 뜻하지 않는다. 음성 내용은 자동 전사·탐지하지 않으므로 원본 전체 화면과 음성을 직접 확인한 뒤 [제출 점검표](portfolio-submission-checklist.md)의 실제 영상 조건과 [파일 목록](portfolio-4310-files.json)을 갱신해야 한다.
