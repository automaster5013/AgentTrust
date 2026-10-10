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

로컬 CPU 모델과 수정 NATS를 포함한 열 전달 이미지의 정확한 실행 ID를 archive로 내보내 Syft CycloneDX SBOM과 Trivy HIGH/CRITICAL 결과를 생성한다. 모든 registry 환경 변수가 제공되면 `ghcr.io/...@sha256:...` 형식만 허용한다. Docker socket을 scanner에 전달하지 않는다. Linux에서 `docker save`의 기본 archive 모드 0600은 비루트 scanner가 읽을 수 없어, 새로 내보낸 공개 소프트웨어 archive만 0644로 설정하고 읽기 전용으로 마운트한다. 실제 Linux 파일시스템 fixture에서 0600 거부·0644 SBOM 생성과 임시 볼륨 제거를 검증했다. 취약점 DB 다운로드에는 공개 네트워크를 사용하며 검사 전용 디스크 캐시를 이용한다. `ignore-unfixed`나 취약점 예외를 적용하지 않는다. 오류로 보고서를 만들지 못한 경우도 실패다.

최초 실제 여덟 이미지 검사에서 HIGH/CRITICAL 183건을 확인하여 원래 스택 전환의 배포 준비를 차단했다. 취약점 예외 없이 Spring Boot 4.1.1/Jackson 3.1.7, Python Alpine 기반, 고정 Go 1.27.2와 OPA/MinIO 의존성 갱신, 사용하지 않는 런타임 도구 제거로 수정했다. 기존 마이그레이션·업무 데이터는 수정하지 않았다. Java 18개·Gateway 11개·Python 6개·TypeScript 11개 계약, 인증/DB/벡터/객체 장애 복구, 비루트 새 PostgreSQL 초기화, 서비스 재시작 후 BFF 흐름을 다시 검증했다. 스캔의 최종 여덟 이미지 통과는 최종 보고서에서 별도로 확인한다.

CI는 소스 보안→소스 통합→정확한 registry digest 실행→이미지 보안/서명의 네 작업으로 구성한다. 실행 검증 artifact는 `runtime-verified-security-pending`이며 서명 완료를 의미하지 않는다. HIGH/CRITICAL 0건 이후에만 Cosign keyless 이미지 서명과 CycloneDX attestation을 생성하고 workflow의 정확한 repository/ref/SHA·OIDC issuer·image digest를 검증한다. 검증 성공 시 별도 `security-verified-signed` artifact에 SBOM·취약점 보고서·Sigstore bundle·checksum을 보관한다. 인증 파일은 일회성 runner 전용이며 artifact에 포함하지 않는다.

별도 공식 인프라 검사에서 NATS 12건·Collector 4건·Tempo 4건·Loki 4건·Prometheus 8건·Grafana 64건의 HIGH/CRITICAL을 확인했다. NATS 2.12.15를 고정 소스와 Go 1.27.2/새 Alpine으로 재빌드하여 0건과 실제 JetStream 영속 복구를 검증했다. 관측성 공식 이미지의 합계 84건 수정은 남아 있다. 이는 이미지별 발견 건수이며 고유 CVE 84개라는 뜻이 아니다. Redis는 0건이었다. 전달 manifest의 `productionSecurityVerified=false`, `officialObservabilitySecurityVerified=false`는 이 한계를 명시한다. 이미지 열 개의 서명이 전체 운영 스택의 안전성이나 배포 승인을 뜻하지 않는다.

[4069f08 기준선 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38073013830)에서 네 작업이 통과하고 정확한 열 이미지의 HIGH/CRITICAL 0건·이미지 서명·SBOM attestation 검증을 확인했다. 다운로드 artifact checksum과 열 SBOM Sigstore bundle의 독립 로컬 암호 검증도 통과했다. 이후 변경은 해당 SHA의 CI·전달 근거를 따로 확인한다. 컨테이너 공급망 서명은 현재 평가 승인 게이트의 서명이 아니며 서버 배포를 수행하지 않는다. 소스 보안 CI와 기존 JavaScript CI는 각각의 검사 범위를 가진다.

## 수동 전달물 검증

Linux Docker 검증기는 호스트와 같은 비루트 UID/GID로 실행한다. Cosign이 생성한 소유자 전용 `0600` 번들을 다른 UID가 읽지 못하는 문제를 해결하며 파일 권한을 넓히지 않는다. 실제 Linux 임시 파일시스템에서 다른 UID의 읽기 거부와 소유자 UID의 서명 20개 검증을 확인했다. Windows는 검사 이미지의 기본 비루트 사용자를 유지한다.

`scripts/stack-delivery-verify.py`는 CI artifact를 받은 환경에서 사용할 읽기 전용 검증기다. 신뢰할 수 있는 CI 실행과 artifact archive digest를 먼저 확인하고, 별도로 확정한 revision 및 `checksums.json`의 SHA-256을 입력해야 한다. 출처가 확인되지 않은 bundle의 자체 checksum만 복사하면 독립적인 신뢰 기준이 되지 않는다.

```powershell
python scripts/stack-delivery-verify.py --bundle <검증한-artifact-폴더> --expected-revision <승인한-40자리-SHA> --expected-checksums-sha256 <별도로-확인한-64자리-SHA256> --repository automaster5013/AgentTrust --docker-tools
```

검증기는 정확한 45개 파일과 크기 제한, checksum map·manifest·실행 이미지 digest·기록된 취약점 결과·SBOM 내용을 확인한 다음, 이미지 열 개와 SBOM 열 개의 서명을 Cosign 3.1.3으로 모두 암호 검증한다. workflow repository/ref/SHA와 OIDC issuer를 고정하며 검증 생략 옵션을 사용하지 않는다. Docker 실행은 검사 도구의 실제 image ID를 고정하고 공개 전달물 폴더만 읽기 전용으로 마운트한다. Docker socket과 registry 인증 파일은 전달하지 않는다. 기본 경로는 공개 Sigstore 신뢰 루트를 조회하기 위해 네트워크를 사용한다. 별도로 신뢰한 Sigstore TrustedRoot JSON을 `--trusted-root`로 지정하면 Docker 검증의 네트워크를 차단한다. 호스트에 정확한 Cosign 버전을 설치했다면 `--docker-tools`를 생략할 수 있다.

신뢰 루트의 로컬 검증은 Cosign의 기본 embedded TUF root에서 `cosign initialize`로 인증한 `trusted_root.json`을 사용했다. 이는 [Sigstore의 TUF 저장소](https://github.com/sigstore/root-signing)에서 전달하는 공개 신뢰 자료다. 온라인 경로와 Docker 네트워크를 차단한 경로 모두 실제 이미지/SBOM 서명 20개를 검증했으며, 서명 바이트를 변조하고 checksum을 다시 계산한 복사본은 거부됐다. 원본 artifact는 수정하지 않았다.

검증 성공은 저장된 Trivy 보고서의 무결성과 서명을 확인한 결과다. 새 취약점 스캔이나 registry 이미지 실행, 서버 배포를 수행하지 않는다. 출력의 `productionDeploymentApproved=false`와 `actualDeploymentPerformed=false`를 유지한다. 운영 배포에는 관측성 취약점 해결, 외부 인증/TLS, 운영 비밀 관리와 복구 검증이 추가로 필요하다. CI에서도 업로드 전에 동일한 소비자 검증기를 실행한다. 경계 테스트는 중복 JSON, 변경된 checksum map, 다른 repository/revision, 추가 파일, 거짓 운영 완료 주장 및 Python 최적화 모드에서의 검증 우회를 거부하는지 확인한다.

- [Semgrep](https://semgrep.dev/docs/)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [Trivy](https://trivy.dev/docs/latest/)
- [Syft CycloneDX](https://github.com/anchore/syft)
- [Cosign](https://docs.sigstore.dev/cosign/)
