# 원래 스택의 보안 검사

`tools/security/Dockerfile`은 Semgrep 1.180.0 이미지 digest와 Gitleaks 8.30.1, Trivy 0.75.0, Syft 1.54.1, Cosign 3.1.3 공식 배포 파일의 SHA-256을 고정한다. 설치만으로 보호 완료를 주장하지 않는다.

## 소스와 Git 이력

```powershell
docker build -t agenttrust-security:local tools/security
python scripts/stack-security-source.py
```

검사는 HEAD의 추적 파일 snapshot과 전체 bare Git 이력만 마운트한다. `.local`의 실행 비밀과 `.env`는 마운트하지 않는다. 네트워크, Docker socket, 루트 쓰기 권한 없이 실행한다. Semgrep의 여섯 규칙은 Python shell/eval/TLS 검증 해제, JavaScript 동적 실행, Java의 무제한 redirect/global CSRF 해제를 검사한다. 양성 fixture 7건과 안전한 음성 fixture를 확인한 다음 실제 소스를 검사한다. 이것이 일반적인 모든 SAST 취약점에 대한 완전한 검사를 뜻하지는 않는다.

Gitleaks는 redaction을 적용한다. `gitleaks.ignore`는 사람이 소스와 현재 구성에 대조한 세 역사적 오탐의 정확한 commit/path/rule/line fingerprint만 포함한다. 경로나 규칙 전체를 제외하지 않는다. 기존 고정 JUnit fixture는 새 커밋에서 매번 생성하는 값으로 바꿨다. 탐지기가 실제 작동하는지, 발급된 적 없는 임시 무작위 양성 입력을 별도로 탐지한 뒤 해당 파일만 제거한다.

로컬 검사에서 Semgrep 규칙 fixture, 실제 소스 0건, Git 이력 0건 및 Gitleaks 양성 탐지를 확인했다. CI는 이 검사를 통합 테스트보다 먼저 실행하고 redacted 보고서를 보관한다. 원격 CI 결과는 해당 실행 결과로 별도 확인해야 한다.

## 이미지 SBOM과 취약점

```powershell
python scripts/stack-security-images.py
```

여덟 애플리케이션 이미지의 정확한 실행 ID를 archive로 내보내 Syft CycloneDX SBOM과 Trivy HIGH/CRITICAL 결과를 생성한다. 모든 registry 환경 변수가 제공되면 `ghcr.io/...@sha256:...` 형식만 허용한다. Docker socket을 scanner에 전달하지 않는다. 취약점 DB 다운로드에는 공개 네트워크를 사용하며 검사 전용 디스크 캐시를 이용한다. `ignore-unfixed`나 취약점 예외를 적용하지 않는다. 오류로 보고서를 만들지 못한 경우도 실패다.

이 단계는 개발 중이다. 이미지 보안 통과와 Cosign 서명·검증은 실제 보고서와 CI 증명이 생기기 전에는 전달 완료 조건으로 주장하지 않는다. 원래 스택의 소스 보안 CI와 기존 JavaScript CI는 각각의 검사 범위를 가진다.

- [Semgrep](https://semgrep.dev/docs/)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [Trivy](https://trivy.dev/docs/latest/)
- [Syft CycloneDX](https://github.com/anchore/syft)
- [Cosign](https://docs.sigstore.dev/cosign/)
