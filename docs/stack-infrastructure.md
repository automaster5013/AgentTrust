# Kubernetes 검토 차트와 Terraform 검증

```powershell
docker build -t agenttrust-infrastructure:local tools/infrastructure
python scripts/stack-infrastructure-check.py
```

Helm 4.3.0, Terraform 1.16.5, Kubeconform 0.8.0 공식 파일의 SHA-256을 검증한다. Kubernetes 1.34.0 schema 저장소의 commit도 고정한다. 실제 Helm strict lint/render와 32개 Kubernetes 리소스의 strict schema 검사, 네 거부 입력, Terraform format/validate와 네 mock plan이 통과했다. `.local/stack-infrastructure-*/summary.json`에 결과를 남긴다. 공개 도구·schema/provider 다운로드만 사용하고 `.kube`·비밀·Docker socket을 마운트하지 않으며 실제 클러스터에 연결하거나 적용하지 않는다. GitHub의 별도 infrastructure workflow가 같은 검증을 반복한다.

`charts/agenttrust-review`는 전환 API·Python 워커·Next.js·WebFlux·OPA의 다섯 애플리케이션과 ClusterIP 서비스를 만든다. 단일 replica, 비루트 UID, 읽기 전용 root, capability 제거, RuntimeDefault seccomp, service-account token 미마운트, bounded memory/CPU/tmp와 readiness/startup probe를 적용한다. 기본 deny와 지정 애플리케이션 경로·DNS·의존 서비스 namespace의 필요한 포트만 허용하는 16개 NetworkPolicy를 렌더한다. NetworkPolicy를 실제로 집행하는 CNI가 필요하며 네트워크 동작을 클러스터에서 검증한 것은 아니다.

차트 기본값에는 실행할 가짜 이미지를 넣지 않는다. 다섯 정확한 `ghcr.io/automaster5013/agenttrust-*@sha256:...` 참조와 Git SHA를 제공해야 렌더한다. CI 검사만 발급되지 않은 `1` digest fixture를 사용한다. mutable tag·public production 모드·외부 의존 DNS·알 수 없는 설정을 거부한다. 차트 자체가 Sigstore admission controller는 아니다. 실제 적용 전에는 보안 전달 artifact와 독립 Cosign 검증을 통해 해당 digest를 확인해야 한다.

데이터 저장 서비스를 이 애플리케이션 차트에 빈 컨테이너로 추가하지 않는다. PostgreSQL/pgvector·NATS JetStream·Redis·Keycloak·MinIO는 별도 `agenttrust-dependencies` namespace에 **미리 구성되고 건강 상태가 검증된 서비스**가 필요하다. 차트는 지정 namespace의 `.svc.cluster.local` DNS를 ExternalName으로 연결한다. DB `agenttrust_stack`과 제한 API 역할, Keycloak 별도 DB/합성 realm·조직/역할·OIDC 클라이언트·back-channel, Redis ACL, NATS stream 인증, MinIO versioned locked bucket과 제한 application 계정은 기존 Compose와 동일한 계약으로 준비해야 한다. 이들 stateful 서비스의 Kubernetes chart·PVC·HA·백업은 아직 구현하지 않았다.

`infra/terraform/review`는 기존 명시적 kubeconfig/context를 사용해 검토 namespace·restricted Pod Security·자원 quota와 이 Helm release를 관리한다. cloud 서버나 Kubernetes 클러스터를 생성하지 않는다. Terraform provider 3.3.0의 lockfile checksum을 보존한다. `install_application=false` 기본값은 namespace/quota 준비 단계다. 별도로 의존 서비스를 확인하고 application namespace에 운영자 소유 비밀을 주입한 뒤 `install_application=true`로 앱 단계를 계획한다. 자동 apply 작업은 없다. namespace/release의 의도하지 않은 삭제를 방지하도록 `prevent_destroy`를 구성했다.

비밀 이름 기본값은 `agenttrust-stack-config`이며 Helm/Terraform은 값 자체를 만들거나 보관하지 않는다. Core만 `database-api-password`, `database-migration-password` env reference를 사용한다. 파일 비밀 키는 다음과 같다.

| 워크로드 | 필요한 파일 키 |
|---|---|
| Core | `stack-demo-credentials`, `stack-worker-token`, `stack-nats-token`, `stack-opa-token`, `stack-oidc-client-secret`, `stack-minio-user`, `stack-minio-password` |
| Python | `stack-worker-token`, `stack-nats-token` |
| Gateway | `stack-redis-token` |
| OPA | `stack-opa-auth.json` |
| Next.js | 없음 |

키마다 workload가 필요한 항목만 `0440`/fsGroup secret volume으로 읽는다. 실제 비밀·kubeconfig·tfvars·state는 `.local` 등 비공개 위치에서 관리한다. Terraform state의 backend·암호화·접근 제어도 운영자 환경에서 결정해야 한다.

현재 OIDC public issuer/callback과 BFF redirect 검증은 루프백 4320/4322로 고정되어 `local-review`만 허용한다. 실제 적용 후 검토 시 포트 전달은 이 주소 계약을 유지해야 하며 실행 중인 Compose와 동시에 같은 host port를 점유할 수 없다. 다섯 앱의 서비스는 외부 LoadBalancer/NodePort/Ingress를 만들지 않는다. 관측 프로필·실제 Ollama의 Kubernetes 배포, 공개 origin/TLS·migrations 전용 Job·분산 세션·HA·rolling upgrade·실제 배포/복귀 시험은 남은 범위다. 이 차트의 렌더 성공을 상용 배포 준비 완료로 사용하지 않는다.

`4069f08`의 서명된 실제 전달 이미지 digest 다섯 개를 사용한 별도 Helm strict lint/render도 통과해 리소스 32개를 확인했다. 이 검사는 가짜 digest fixture와 구분하며, 네트워크·클러스터 연결 없이 렌더링한 결과다. 클러스터에서의 실행이나 의존 서비스 준비를 뜻하지 않는다. 수동 전달물의 이미지/SBOM 서명 20개를 다시 확인하는 방법은 [보안 전달물 검증](stack-security.md#수동-전달물-검증)에 기록했다.

- [Helm values](https://helm.sh/docs/chart_template_guide/values_files/)
- [Terraform variable validation](https://developer.hashicorp.com/terraform/language/values/variables)
- [Kubeconform](https://github.com/yannh/kubeconform)
