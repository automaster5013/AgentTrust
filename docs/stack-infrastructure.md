# Kubernetes 검토 차트와 Terraform 검증

```powershell
docker build -t agenttrust-infrastructure:local tools/infrastructure
python scripts/stack-infrastructure-check.py
```

Helm 4.3.0, Terraform 1.16.5, Kubeconform 0.8.0 공식 파일의 SHA-256을 검증한다. Kubernetes 1.34.0 schema 저장소의 commit도 고정한다. 실제 Helm strict lint/render와 36개 Kubernetes 리소스의 strict schema 검사, 네 거부 입력, Terraform format/validate와 네 mock plan이 통과했다. `.local/stack-infrastructure-*/summary.json`에 결과를 남긴다. 공개 도구·schema/provider 다운로드만 사용하고 `.kube`·비밀·Docker socket을 마운트하지 않으며 실제 클러스터에 연결하거나 적용하지 않는다. GitHub의 별도 infrastructure workflow가 같은 검증을 반복한다.

`charts/agenttrust-review`는 전환 API·Python 워커·Next.js·WebFlux·OPA·Promptfoo 정답 검증기의 여섯 애플리케이션과 ClusterIP 서비스를 만든다. 단일 replica, 비루트 UID, 읽기 전용 root, capability 제거, RuntimeDefault seccomp, service-account token 미마운트, bounded memory/CPU/tmp와 readiness/startup probe를 적용한다. 기본 deny와 지정 애플리케이션 경로·DNS·의존 서비스 namespace의 필요한 포트만 허용하는 18개 NetworkPolicy를 렌더한다. NetworkPolicy를 실제로 집행하는 CNI가 필요하며 네트워크 동작을 클러스터에서 검증한 것은 아니다.

차트 기본값에는 실행할 가짜 이미지를 넣지 않는다. 다섯 정확한 `ghcr.io/automaster5013/agenttrust-*@sha256:...` 참조와 Git SHA를 제공해야 렌더한다. CI 검사만 발급되지 않은 `1` digest fixture를 사용한다. mutable tag·public production 모드·외부 의존 DNS·알 수 없는 설정을 거부한다. 차트 자체가 Sigstore admission controller는 아니다. 실제 적용 전에는 보안 전달 artifact와 독립 Cosign 검증을 통해 해당 digest를 확인해야 한다.

데이터 저장 서비스를 이 애플리케이션 차트에 빈 컨테이너로 추가하지 않는다. PostgreSQL/pgvector·NATS JetStream·Redis·Keycloak·MinIO는 별도 `agenttrust-dependencies` namespace에 **미리 구성되고 건강 상태가 검증된 서비스**가 필요하다. 차트는 지정 namespace의 `.svc.cluster.local` DNS를 ExternalName으로 연결한다. DB `agenttrust_stack`과 제한 API 역할, Keycloak 별도 DB/합성 realm·조직/역할·OIDC 클라이언트·back-channel, Redis ACL, NATS stream 인증, MinIO versioned locked bucket과 제한 application 계정은 기존 Compose와 동일한 계약으로 준비해야 한다. 이들 stateful 서비스의 Kubernetes chart·PVC·HA·백업은 아직 구현하지 않았다.

`infra/terraform/review`는 기존 명시적 kubeconfig/context를 사용해 검토 namespace·restricted Pod Security·자원 quota와 이 Helm release를 관리한다. cloud 서버나 Kubernetes 클러스터를 생성하지 않는다. Terraform provider 3.3.0의 lockfile checksum을 보존한다. `install_application=false` 기본값은 namespace/quota 준비 단계다. 별도로 의존 서비스를 확인하고 application namespace에 운영자 소유 비밀을 주입한 뒤 `install_application=true`로 앱 단계를 계획한다. 자동 apply 작업은 없다. namespace/release의 의도하지 않은 삭제를 방지하도록 `prevent_destroy`를 구성했다.

비밀 이름 기본값은 `agenttrust-stack-config`이며 Helm/Terraform은 값 자체를 만들거나 보관하지 않는다. 오래 실행되는 Core는 `database-api-password`만 받는다. 같은 이미지의 `schema-migrate` init container만 `database-migration-password`를 받아 먼저 종료한다. 파일 비밀 키는 다음과 같다.

| 워크로드 | 필요한 파일 키 |
|---|---|
| Core | `stack-demo-credentials`, `stack-worker-token`, `stack-nats-token`, `stack-opa-token`, `stack-oidc-client-secret`, `stack-minio-user`, `stack-minio-password` |
| Python | `stack-worker-token`, `stack-nats-token` |
| Gateway | `stack-redis-token` |
| OPA | `stack-opa-auth.json` |
| Next.js | 없음 |

키마다 workload가 필요한 항목만 `0440`/fsGroup secret volume으로 읽는다. 실제 비밀·kubeconfig·tfvars·state는 `.local` 등 비공개 위치에서 관리한다. Terraform state의 backend·암호화·접근 제어도 운영자 환경에서 결정해야 한다.

기본 검토 차트는 루프백 4320/4322의 `local-review`만 허용한다. 애플리케이션의 별도 [HTTPS OIDC 검토 프로필](stack-oidc-endpoints.md)은 명시한 origin·issuer·Secure/Lax 쿠키를 검증하지만, 이 차트의 공개 TLS·운영 프로필이나 실제 클러스터 배포를 구현한 것은 아니다. 실제 적용 후 검토 시 포트 전달은 이 주소 계약을 유지해야 하며 실행 중인 Compose와 동시에 같은 host port를 점유할 수 없다. 다섯 앱의 서비스는 외부 LoadBalancer/NodePort/Ingress를 만들지 않는다. 관측 프로필·실제 Ollama의 Kubernetes 배포, 공개 origin/TLS·migrations 전용 Job·분산 세션·HA·rolling upgrade·실제 배포/복귀 시험은 남은 범위다. 이 차트의 렌더 성공을 상용 배포 준비 완료로 사용하지 않는다.

`4069f08`의 서명된 실제 전달 이미지 digest 다섯 개를 사용한 별도 Helm strict lint/render도 통과해 리소스 32개를 확인했다. 이 검사는 가짜 digest fixture와 구분하며, 네트워크·클러스터 연결 없이 렌더링한 결과다. 클러스터에서의 실행이나 의존 서비스 준비를 뜻하지 않는다. 수동 전달물의 이미지/SBOM 서명 20개를 다시 확인하는 방법은 [보안 전달물 검증](stack-security.md#수동-전달물-검증)에 기록했다.

- [Helm values](https://helm.sh/docs/chart_template_guide/values_files/)
- [Terraform variable validation](https://developer.hashicorp.com/terraform/language/values/variables)
- [Kubeconform](https://github.com/yannh/kubeconform)


검증기의 Terraform 작업 디렉터리와 재다운로드 가능한 provider 바이너리는 제한된 컨테이너 `/tmp` 메모리 파일시스템에서만 생성한다. 공개 모듈 네 파일만 복사하므로 로컬 tfvars·state·캐시를 보고서에 포함하지 않는다. 성공/실패 종료 시 새 작업만 회수하며 컨테이너 종료에도 임시 메모리가 해제된다. 호스트에는 summary·렌더·검증 로그를 보존한다. 이전 검사의 보관 폴더에는 적용하지 않는다. tmpfs는 384 MiB이며 lockfile로 고정한 Terraform provider 실행을 허용한다. 컨테이너 메모리는 기존 1 GiB, 비루트·capability 제거·읽기 전용 루트 한도를 유지한다.

### Local OIDC workload and probe contract

The review chart explicitly pins core API, Gateway and Console to the same `local-review` application origin (`http://127.0.0.1:4320`) and public issuer (`http://127.0.0.1:4322/realms/agenttrust`). A Console image built for another profile refuses these environment values at startup; compare its image intent and independently authenticate its digest before installation. The chart continues to reject production mode.

Console startup and readiness probes send `Host: 127.0.0.1:4320` through `httpHeaders`, preserving the request destination at the Pod IP while making the local profile explicit. Kubernetes recommends the Host header for virtual-host probes rather than changing the probe's destination `host`: [official probe documentation](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/).

The isolated infrastructure check asserts all three workload endpoint contracts and both probe headers. It validates 36 resources in each of three signing profiles (108 total) and runs seven mocked Terraform plans. This validates manifests without contacting a cluster. It does not demonstrate an installed cluster, working port forwards, external HTTPS, persistent dependencies, or high availability.

The public first page currently returns 200 with either the configured Host or a different Host. The Host allowlist applies to `/backend` authentication and proxy requests; the actual Console probe smoke check verifies both public-page responses and foreign-Host backend rejection. The probe header makes intent explicit rather than repairing a demonstrated readiness failure.

### Development signing projection and rendered resource budget

Signing remains disabled by default. Review values may explicitly select
`signing.mode: local-development` and optionally `signing.historyEnabled: true`.
Only Core then receives `stack-gate-key-pair` and, when requested,
`stack-gate-retired-keys` from the existing operator-owned Secret. Both use the
existing read-only `/run/secrets` projection with mode `0440` and Core's fsGroup.
Other workloads cannot mount those keys. History with disabled signing,
production signing, non-boolean history flags and caller-selected key paths are
rejected. The chart never generates secret contents or production authority.

Terraform exposes the same review-only flags as
`development_signing = { enabled = true, history_enabled = true }`; only those
flags and the existing Secret name enter Helm values/state. Missing Secret keys
must be provisioned by the operator before any installation. Changing key or
history bytes requires a controlled Core restart and the acceptance checks in
[development key history](stack-signing-key-history.md). Production KMS,
custody, rotation, revocation distribution and target-cluster testing remain open.

The six rendered workload CPU limits sum to 6.5 cores. The earlier Terraform
quota of 6 could not admit all six together; a new independent mock-plan check
reproduced that failure, and the review quota now permits 7. Container limits were
not reduced. The checker derives CPU/memory totals from actual Helm output into
an ephemeral public JSON fixture, then compares them with planned ResourceQuota
values. Its seven mocked plans include quota coverage, signing/history flag
propagation and invalid-history refusal. Run them through
`python scripts/stack-infrastructure-check.py`, which generates that fixture;
it does not read kubeconfig, tfvars, real state or secret values, and never applies
resources. A passing plan does not prove a cluster has sufficient node capacity.

### Independent revision validation

Original-stack and infrastructure CI now group by workflow, ref and source SHA.
Distinct revisions can validate concurrently on isolated GitHub-hosted runners;
an existing run is not cancelled. Original-stack publication uses only SHA tags
and records immutable digests, and every artifact name includes the source SHA.
The legacy workflow's mutable-main promotion policy is unchanged. These are
validation/publication jobs, not shared-environment deployments.

The infrastructure checker verifies those isolation assumptions together with the
complete source-security → integration → images → image-security dependency
chain and main-only publication conditions. It rejects synthetic shared groups,
mutable image tags, shared artifact names and cancellation of another revision.
No test, image scan, signature check or runtime verification is skipped. This
removes branch-wide validation waiting while preserving per-revision evidence;
available hosted-runner capacity can still cause queuing.

Reference: [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

### Separate migration and API credentials

The same Core image supports the single-purpose `--migrate-only` command. It
runs the existing, unchanged Flyway resources and exits without starting Spring's
HTTP application. Compose's `stack-migrate` is a bounded, non-root, portless
one-shot process; Core depends on its successful completion. Registry overrides
bind both processes to the same authenticated Core digest. The stopped migration
container is retained; the usual twenty source services remain the running set.

The review chart uses an init container with that same image and command. Only
that init container receives the migration credential. It mounts temporary memory
and no application signing, OIDC or messaging secrets. Pod process namespaces are
not shared. Its CPU and memory requests/limits do not exceed the Core container's,
so the existing Pod admission budget and seven-core namespace quota still cover
initialization. Rendering continues to validate 36 resources in each of the three
signing profiles, 108 in total. This is manifest validation, not cluster execution.

The API disables automatic Flyway startup, rejects migration credentials and
alternate Spring datasource/Flyway/JSON/external-config overrides, and connects
only as `agenttrust_stack_api`. Before opening HTTP, it verifies the real database
role is not a superuser, RLS bypasser, database/role creator or replication role,
cannot create the database/public schema and has no privileged owner membership.
`--check-database-role` performs that read-only check and exits without serving.
Migration failures produce a fixed refusal marker rather than SQL or credential
details. The short-lived migration logger has a separate configuration; API
logging is unchanged. Flyway usage telemetry is disabled for migration processes.

`python scripts/stack-database-process-smoke.py` checks the actual API PID1
environment without recording its values, verifies distinct owner/API credentials,
and requires the same-image migration process to have exited successfully without
host ports. Source and registry CI preserve its safe JSON report. Private settings
and all sixteen existing SQL migration files are unchanged by this separation.
`stack-database-process-adversarial.py` also uses the actual running Core image on
a fresh, portless PostgreSQL instance backed only by temporary memory. It checks
initial and repeated migration, owner-secret contamination, mixed process flags,
actual superuser elevation and owner-role membership, followed by recovery of the
restricted role. It removes only its labelled fixture resources and generated
credentials; source services and original data volumes are not changed.
The fixture waits for PostgreSQL over TCP loopback before starting the JDBC
migration. A Unix-socket readiness response can come from the entrypoint's
temporary initialization server, which does not yet accept TCP. A delayed-init
fixture reproduced that premature migration failure; the same delay with the TCP
check permits the complete migration and privileged-role rejection checks. Safe
failure reports include a fixed phase name and process exit code, without raw
database output or credential values.
Future schema changes still require a controlled migration, compatible rollout,
backup and rollback policy on the chosen target; this does not establish HA or an
operational deployment.

API datasource configuration uses the explicit `STACK_DATABASE_*` contract.
Do not inject general Spring JSON/config locations, datasource overrides or
migration variables into the API container. Migration and API passwords must be
different. In Kubernetes the existing Secret contains both keys, but the migration
key is referenced only by the completed init container; the Core secret-file
projection does not include it. Operator RBAC, target dependencies and external
backup/key custody remain separate deployment requirements.

The programmatic migration uses the existing Flyway dependency and its
[Java API](https://documentation.red-gate.com/flyway/reference/usage/api-java);
no new migration engine or external service is introduced.
