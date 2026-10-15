# 원래 스택의 보안 검사

단일 관측성 이미지 검사는 고정 digest의 공식 `grafana/grafana:13.x.y@sha256:...` 후보도 허용한다. 공식 Grafana 후보의 export 상한은 3 GiB, 기존 자체 빌드 후보는 1 GiB다. 이미지 크기만큼의 export 여유와 Windows 22 GiB/Linux 4 GiB 잔여 공간을 생성 전에 확인하며, 태그만 있는 공식 이미지·다른 저장소·다른 서비스로의 참조 치환은 거절한다. 후보 검사는 실행 중인 Grafana나 기존 볼륨을 바꾸지 않는다.

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

로컬 CPU 모델, 수정 NATS·Collector와 Promptfoo SDK 평가기를 포함한 열다섯 전달 이미지의 정확한 실행 ID를 archive로 내보내 Syft CycloneDX SBOM과 Trivy HIGH/CRITICAL 결과를 생성한다. 모든 registry 환경 변수가 제공되면 `ghcr.io/...@sha256:...` 형식만 허용한다. Docker socket을 scanner에 전달하지 않는다. Linux에서 `docker save`의 기본 archive 모드 0600은 비루트 scanner가 읽을 수 없어, 새로 내보낸 공개 소프트웨어 archive만 0644로 설정하고 읽기 전용으로 마운트한다. 실제 Linux 파일시스템 fixture에서 0600 거부·0644 SBOM 생성과 임시 볼륨 제거를 검증했다. 취약점 DB 다운로드에는 공개 네트워크를 사용하며 검사 전용 디스크 캐시를 이용한다. `ignore-unfixed`나 취약점 예외를 적용하지 않는다. 오류로 보고서를 만들지 못한 경우도 실패다.

최초 실제 여덟 이미지 검사에서 HIGH/CRITICAL 183건을 확인하여 원래 스택 전환의 배포 준비를 차단했다. 취약점 예외 없이 Spring Boot 4.1.1/Jackson 3.1.7, Python Alpine 기반, 고정 Go 1.27.2와 OPA/MinIO 의존성 갱신, 사용하지 않는 런타임 도구 제거로 수정했다. 기존 마이그레이션·업무 데이터는 수정하지 않았다. Java 18개·Gateway 11개·Python 6개·TypeScript 11개 계약, 인증/DB/벡터/객체 장애 복구, 비루트 새 PostgreSQL 초기화, 서비스 재시작 후 BFF 흐름을 다시 검증했다. 스캔의 최종 여덟 이미지 통과는 최종 보고서에서 별도로 확인한다.

CI는 소스 보안→소스 통합→정확한 registry digest 실행→이미지 보안/서명의 네 작업으로 구성한다. 실행 검증 artifact는 `runtime-verified-security-pending`이며 서명 완료를 의미하지 않는다. HIGH/CRITICAL 0건 이후에만 Cosign keyless 이미지 서명과 CycloneDX attestation을 생성하고 workflow의 정확한 repository/ref/SHA·OIDC issuer·image digest를 검증한다. 검증 성공 시 별도 `security-verified-signed` artifact에 SBOM·취약점 보고서·Sigstore bundle·checksum을 보관한다. 인증 파일은 일회성 runner 전용이며 artifact에 포함하지 않는다.

별도 공식 인프라 검사에서 NATS 12건·Collector 4건·Tempo 4건·Loki 4건·Prometheus 8건·Grafana 64건의 HIGH/CRITICAL을 확인했다. NATS 2.12.15를 고정 소스와 Go 1.27.2/새 Alpine으로 재빌드하여 0건과 실제 JetStream 영속 복구를 검증했다. 원래 관측성 공식 이미지의 합계는 84건이다. Collector의 4건은 동일 upstream 버전 재빌드와 실제 재검사에서 0건으로 수정했다. Tempo·Loki도 각각 원래 4건을 수정한 registry 이미지의 실제 스캔 0건과 로컬 통합을 확인했다. Prometheus도 고정 소스·UI·두 실행 바이너리를 재빌드하여 원격 및 로컬 HIGH/CRITICAL 0건과 실제 관측 경로를 검증했다. Grafana의 원래 보고서 64건에 대한 수정·재검증은 남아 있다. 이는 이미지별 발견 건수이며 고유 CVE 84개라는 뜻이 아니다. Redis는 0건이었다. 전달 manifest의 `productionSecurityVerified=false`, `officialObservabilitySecurityVerified=false`는 이 한계를 명시한다. 전달 이미지의 서명이 전체 운영 스택의 안전성이나 배포 승인을 뜻하지 않는다.

[4069f08 기준선 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38073013830)에서 네 작업이 통과하고 정확한 열 이미지의 HIGH/CRITICAL 0건·이미지 서명·SBOM attestation 검증을 확인했다. 다운로드 artifact checksum과 열 SBOM Sigstore bundle의 독립 로컬 암호 검증도 통과했다. 이후 변경은 해당 SHA의 CI·전달 근거를 따로 확인한다. 컨테이너 공급망 서명은 현재 평가 승인 게이트의 서명이 아니며 서버 배포를 수행하지 않는다. 소스 보안 CI와 기존 JavaScript CI는 각각의 검사 범위를 가진다.


2026-10-11 별도 Grafana 후보는 고정 서버 소스와 공식 서명이 유효한 13개 플러그인으로 실제 실행했다. 전체 Docker 이미지 검사에서 HIGH/CRITICAL 56건이 남아 게시와 적용을 거부했다. 서버 수정만으로 플러그인의 내장 Go 의존성이 갱신되지 않는다. 공식 서명 검증을 끄거나 취약 바이너리를 검사에서 제외하지 않는다. 단순 파일시스템 검사는 Go 실행 파일을 탐지하지 못할 수 있으므로 전체 이미지 결과를 기준으로 판단한다. [후보 검사](https://github.com/automaster5013/AgentTrust/actions/runs/38111502365)는 원래 실행 이미지의 검증 완료를 뜻하지 않는다.

이미지 검사 전 모든 실행 ID와 예상 archive 크기를 확인한다. archive는 한 번에 하나만 유지하므로 Windows에서는 가장 큰 archive의 예상 크기 외에 22GiB, Linux에서는 4GiB 여유 공간을 요구하고 각 export 전에 다시 확인한다. 부족하면 첫 archive를 만들기 전에 실패 보고서를 남긴다. 로컬 공간 부족으로 검사를 거부한 결과는 검사 통과를 뜻하지 않는다.

검사에 사용한 Docker archive는 임시 입력이다. 전체 전달 이미지 검사는 각 이미지의 SBOM·취약점 보고서를 만든 후 해당 실행에서 생성한 archive를 제거하며, 관측성 단일 이미지 검사도 종료 시 제거한다. 오류나 부분 export도 종료 정리를 시도한다. 다른 실행의 파일과 기존 archive는 제거하지 않는다. 정리에 실패하면 검사 완료로 표시하지 않으며, 보고서와 archive SHA-256은 보존한다. Trivy 다운로드 캐시는 공유 경로에서 재사용하고 반복 실행별로 복제하지 않는다. 프로세스 강제 종료 시 남은 파일은 자동 제거를 보장하지 않으며 별도 확인이 필요하다.

## 수동 전달물 검증

Linux Docker 검증기는 호스트와 같은 비루트 UID/GID로 실행한다. Cosign이 생성한 소유자 전용 `0600` 번들을 다른 UID가 읽지 못하는 문제를 해결하며 파일 권한을 넓히지 않는다. 실제 Linux 임시 파일시스템에서 다른 UID의 읽기 거부와 소유자 UID의 서명 20개 검증을 확인했다. Windows는 검사 이미지의 기본 비루트 사용자를 유지한다.

`scripts/stack-delivery-verify.py`는 CI artifact를 받은 환경에서 사용할 읽기 전용 검증기다. 신뢰할 수 있는 CI 실행과 artifact archive digest를 먼저 확인하고, 별도로 확정한 revision 및 `checksums.json`의 SHA-256을 입력해야 한다. 출처가 확인되지 않은 bundle의 자체 checksum만 복사하면 독립적인 신뢰 기준이 되지 않는다.

```powershell
python scripts/stack-delivery-verify.py --bundle <검증한-artifact-폴더> --expected-revision <승인한-40자리-SHA> --expected-checksums-sha256 <별도로-확인한-64자리-SHA256> --repository automaster5013/AgentTrust --docker-tools
```

검증기는 기존 schema 2의 열 이미지·45개 파일 또는 Collector를 추가한 schema 3의 열한 이미지·49개 파일, 또는 Tempo·Loki를 추가한 schema 4의 열세 이미지·57개 파일, Prometheus를 추가한 schema 5의 열네 이미지·61개 파일과 크기 제한, checksum map·manifest·실행 이미지 digest·기록된 취약점 결과·SBOM 내용을 확인한 다음, 각 schema의 모든 이미지와 SBOM 서명(20개·22개·26개·28개)을 Cosign 3.1.3으로 암호 검증한다. workflow repository/ref/SHA와 OIDC issuer를 고정하며 검증 생략 옵션을 사용하지 않는다. Docker 실행은 검사 도구의 실제 image ID를 고정하고 공개 전달물 폴더만 읽기 전용으로 마운트한다. Docker socket과 registry 인증 파일은 전달하지 않는다. 기본 경로는 공개 Sigstore 신뢰 루트를 조회하기 위해 네트워크를 사용한다. 별도로 신뢰한 Sigstore TrustedRoot JSON을 `--trusted-root`로 지정하면 Docker 검증의 네트워크를 차단한다. 호스트에 정확한 Cosign 버전을 설치했다면 `--docker-tools`를 생략할 수 있다.

참조 정답 검증기를 추가하는 schema 6은 15개 이미지·65개 파일·30개 이미지 및 SBOM 서명을 요구한다. 기존 schema 2–5 검증은 유지한다. 로컬 경계 테스트 15개는 통과했으며, 새 schema의 실제 원격 전달·30개 서명 검증 완료 여부는 해당 CI 결과로 별도 확인한다. 로컬 검증기 이미지의 실제 Promptfoo SDK 테스트와 취약점 검사만으로 전체 전달 완료를 주장하지 않는다.

신뢰 루트의 로컬 검증은 Cosign의 기본 embedded TUF root에서 `cosign initialize`로 인증한 `trusted_root.json`을 사용했다. 이는 [Sigstore의 TUF 저장소](https://github.com/sigstore/root-signing)에서 전달하는 공개 신뢰 자료다. 온라인 경로와 Docker 네트워크를 차단한 경로 모두 실제 이미지/SBOM 서명 20개를 검증했으며, 서명 바이트를 변조하고 checksum을 다시 계산한 복사본은 거부됐다. 원본 artifact는 수정하지 않았다.

검증 성공은 저장된 Trivy 보고서의 무결성과 서명을 확인한 결과다. 새 취약점 스캔이나 registry 이미지 실행, 서버 배포를 수행하지 않는다. 출력의 `productionDeploymentApproved=false`와 `actualDeploymentPerformed=false`를 유지한다. 운영 배포에는 관측성 취약점 해결, 외부 인증/TLS, 운영 비밀 관리와 복구 검증이 추가로 필요하다. CI에서도 업로드 전에 동일한 소비자 검증기를 실행한다. 경계 테스트는 중복 JSON, 변경된 checksum map, 다른 repository/revision, 추가 파일, 거짓 운영 완료 주장 및 Python 최적화 모드에서의 검증 우회를 거부하는지 확인한다.

- [Semgrep](https://semgrep.dev/docs/)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [Trivy](https://trivy.dev/docs/latest/)
- [Syft CycloneDX](https://github.com/anchore/syft)
- [Cosign](https://docs.sigstore.dev/cosign/)

Collector 추가 전달 schema의 경계 테스트는 8개가 로컬에서 통과했다. schema 3에서 Collector 서명 누락과 schema 2로의 잘못된 축소를 거부한다. 열한 이미지의 원격 실행·보안·서명 결과는 해당 새 CI가 실제 완료한 후에 별도로 확인한다. 기존 열 이미지 전달물의 검증 지원은 유지한다.

Tempo·Loki를 포함한 schema 4의 경계 테스트는 로컬 10개가 통과했으며 누락된 저장 서비스 서명, schema 축소와 미지원 schema를 거부한다. 변경한 소비자 검증기로 기존 5ea0f52 전달물의 이미지/SBOM 서명 20개도 Docker 네트워크를 차단한 채 실제 암호 검증했다. schema 4의 원격 전체 전달 검증은 새 CI 완료 후 별도 기록한다. [개발 DB 복원 훈련](stack-backup.md)은 운영 키 관리나 전체 시스템 복구를 증명하지 않는다.

Prometheus를 포함한 schema 5의 경계 테스트 13개가 로컬에서 통과했다. 14개 이미지 각각의 이미지 서명과 SBOM attestation, 정확히 61개 파일을 요구하며 Prometheus proof 누락·schema 축소·미지원 schema를 거부한다. 전체 28개 실제 원격 서명 검증과 새 커밋 registry 실행은 CI 완료 후 별도로 확인한다.

## 15개 이미지의 실제 전달 검증

[6962d11848f3d01bbd023a9207017bc5d0bde2bf CI](https://github.com/automaster5013/AgentTrust/actions/runs/38115649221)의 소스 보안·소스 통합·정확한 registry 이미지 실행·보안/서명 네 작업이 모두 통과했다. 내려받은 runtime 및 security artifact의 GitHub archive digest와 내부 checksum을 대조했다. 소스 통합 보고서 35개와 registry 실행 보고서 23개가 완료됐으며 브라우저 10개 검사는 소스 통합에서 수행했다.

Schema 6의 실제 65개 파일·15개 이미지와 HIGH/CRITICAL 0건을 확인하고, 별도로 인증한 공개 TrustedRoot와 네트워크가 차단된 Cosign 3.1.3으로 30개 이미지/SBOM 서명을 독립 암호 검증했다. 같은 revision·repository·main ref·OIDC issuer를 고정했다. 복사본의 실제 인증서 서명 한 바이트를 변조하고 checksum map까지 다시 계산해도 `cryptographic-verification` 단계에서 거부됐다. 변조 복사본은 메모리 파일시스템에만 만들었고 원본 65개 파일의 바이트는 그대로였다.

이 결과는 해당 커밋과 보관된 취약점 보고서에 한정된다. 새로운 취약점 검사나 서버 배포를 수행한 결과가 아니다. 별도 공식 Grafana 후보는 유효한 플러그인 서명에도 HIGH/CRITICAL 56건으로 실패하여 적용하지 않았다. 현재 Grafana 보안 수정, 운영 IdP/TLS·신뢰키·백업과 전체 시스템 복구 검증이 남아 있으며 `productionSecurityVerified`, `officialObservabilitySecurityVerified`, `productionDeploymentApproved`는 계속 `false`다. 이후 커밋의 전달물은 다시 검증한다.

소스 검사도 앞으로 해당 실행이 만든 임시 작업 디렉터리에 Git archive·tracked source·bare history 사본을 생성하고 성공/실패 종료 때 소유권을 확인하여 회수한다. 기존 보관 사본과 검사 보고서에는 적용하지 않는다. 작업 디렉터리가 교체됐거나 부모 소유권이 달라지면 정리를 거부하고 검사를 미완료로 표시한다.


2026-10-11의 `d43ae410ec966c454a632b0bfa2d738ee257e0f0`는 [전체 전달 CI](https://github.com/automaster5013/AgentTrust/actions/runs/38129714309)의 네 작업이 성공했다. 15개 게시 이미지 실행·HIGH/CRITICAL 0건·30개 이미지/SBOM 서명을 확인했으며, 인증된 artifact 메타데이터의 archive digest를 대조한 뒤 로컬 소비자 검증기로 서명을 독립 암호 검증했다. 해당 이미지 검사 보고서의 `temporaryArchivesRemoved=true`도 확인했다. 이는 이 커밋의 실제 검사 근거이며 이후 기능 커밋의 CI 결과는 별도로 확인한다. Grafana와 운영 준비 항목의 미완료 상태는 유지한다.

Source revision `15fce601ebdfba5fdf3c886a9a73f3fc27d9e221` passed [all four original-stack CI jobs](https://github.com/automaster5013/AgentTrust/actions/runs/38147084755). The authenticated delivery ZIP digest and all 65 file checksums matched. Local independent verification passed all 30 image/SBOM signatures for 15 images, including a second verification with networking disabled and the separately trusted Sigstore root. A memory-only copy with one certificate-signature byte changed was refused at cryptographic verification even after recomputing the checksum map; the original bundle remained unchanged. HIGH/CRITICAL count was zero in the integrity-verified CI reports. The checksum-map SHA-256 is `f41abdcd9a13e86ed91d6b0cae5930b1c3dadcce6aa110a22d928faed3cb5839`. This is evidence for that revision and scan snapshot. Grafana remains excluded from this 15-image proof and its security remediation remains unresolved; production deployment/security and paid-provider claims remain false.

2026-10-12에는 비교 기준 게이트의 `786322d7ce90c226e88a0b360e77bdac16331df5`도 [소스·정확한 registry 실행·보안·서명 CI 네 작업](https://github.com/automaster5013/AgentTrust/actions/runs/38165864678)이 통과했다. 인증된 ZIP 및 65개 파일의 무결성을 확인하고 30개 이미지·SBOM 서명을 로컬과 네트워크 차단 환경에서 독립 검증했다. 인증서 서명 한 바이트를 바꾸고 checksum map까지 다시 계산한 메모리 복사본은 암호 검증에서 거부됐으며 원본은 그대로였다. 15개 이미지의 HIGH/CRITICAL 0건은 해당 CI 검사 시점의 결과다. [별도 checksum anchor와 전달 근거](github-delivery.md#original-stack-baseline-delivery-validation--2026-10-12)를 따르며 Grafana와 운영 준비의 미완료 상태는 유지한다.


## 2026-10-15 curl runtime remediation

The exact `5383348d880ea0675a33dec929f2930a7d09bc2f` image-security job refused six HIGH findings: `CVE-2026-92392` affected both `curl` and `libcurl4t64` in Core, Gateway and Identity. All 15 images were scanned; the other twelve had no HIGH/CRITICAL findings in that snapshot. Source integration and exact registry runtime passed, but no completed signed delivery is claimed for that revision.

The three affected Dockerfiles keep the existing immutable Temurin/JRE base and install only the two official Ubuntu correction packages at `8.18.0-1ubuntu2.8`, using authenticated APT metadata, before discarding package indexes. The packages remain installed and included in the full-image scan. [Ubuntu USN-8927-1](https://ubuntu.com/security/notices/USN-8927-1) identifies this correction. A candidate build and its actual whole-image security result must be checked; a changed Dockerfile or successful package installation alone is not security acceptance. Exact revised registry runtime, all CI jobs and the new 30 signatures must complete separately. Existing local services have not been replaced by this source correction.

Grafana remains outside the 15-image delivery and its separate 56 findings remain unresolved. Production deployment/security approval remains false.
