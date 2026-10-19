# Persistent dependency review definitions

`charts/agenttrust-dependencies-review` prepares the five dependencies used by the
original stack: PostgreSQL/pgvector, NATS JetStream, Redis, Keycloak and MinIO.
These are **review definitions**, not an installed Kubernetes environment or
production approval. The cloud, cluster, StorageClass, real identities, public
TLS, HA and offsite recovery remain unselected or unverified.

The chart requires the separate `agenttrust-dependencies` namespace, exact tested
source revision and five independently verified immutable image digests. It also
requires an operator-reviewed StorageClass. Defaults deliberately cannot render
without those inputs. `mode: production`, mutable/foreign/substituted image
references, unknown settings, caller-selected deletion policies, another
application namespace and invalid storage quantities are refused. There is no
Ingress, LoadBalancer, NodePort, Secret value, hostPath, host networking or
service-account token projection.

Each dependency has one non-root StatefulSet, its existing image's UID, bounded
CPU/memory and probes, a normal internal Service, a headless governing Service
and one `ReadWriteOnce` filesystem claim. Storage is 8/2/1/1/8GiB by default for
PostgreSQL/NATS/Redis/Keycloak/MinIO, with bounded explicit overrides. A StorageClass
must support the required filesystem ownership/fsGroup behavior; this has not
been tested on a target CSI driver. PVC retention is explicitly `Retain` on
deletion and scale-down, and updates use `OnDelete`. This neither backs up data
nor provides HA or a verified upgrade/rollback procedure. Existing claims are not
imported through a caller-specified claim reference.

PostgreSQL writes under a `pgdata` subdirectory of its claim and has a separate
bounded socket directory. NATS and MinIO retain their existing `/tmp`-based data
layout on the claim. Redis persists `/data`. Keycloak persists its data and
receives the realm import as a separate read-only projection. All secret files
are selected individually with mode `0440`; their values are never rendered.
The Keycloak DB and bootstrap administrator passwords use specific Secret key
references, following the existing development image contract.

The operator owns one `agenttrust-dependency-config` Secret in the dependency
namespace. It is separate from the existing application namespace Secret:

| Consumer | Required keys or matching contracts |
|---|---|
| PostgreSQL | `database-migration-password`, `database-bootstrap.sql` |
| NATS | `stack-nats-config`; its token must match the application `stack-nats-token` |
| Redis | `stack-redis-config`, `stack-redis-token`; gateway ACL/config/token must agree |
| Keycloak | `database-identity-password`, `identity-admin-password`, `stack-identity-realm` |
| MinIO | `stack-minio-root-user`, `stack-minio-root-password` |
| Optional MinIO initialization | The two root keys plus limited `stack-minio-user`, `stack-minio-password` |

`database-bootstrap.sql` is an operator-reviewed fresh-database input. It must
create the separate identity DB/role and the restricted application role with
passwords consistent with the application Secret. It must preserve the existing
separate migration-owner/API-role contract and required extensions. The chart
cannot inspect or certify that private SQL, role grants, matching secret values,
realm/client claim mappers or existing data. Initial PostgreSQL readiness proves
connection acceptance, not correct role isolation. Actual application startup
and database/identity acceptance remain required in the chosen target.

Do not copy exposed development credentials into a shared environment. Prepare
new scoped synthetic identities for a review environment; original local
credentials and data remain preserved. Enterprise IdP lifecycle and production
password/key delivery are separate work.

MinIO bucket/user/retention initialization is off by default. An explicit
`initializeObjectStore: true` renders a revision-named Job using the same exact
object-store image and its existing `minio-init` program. It has no automatic
retry, a 120-second active deadline and only the four required secret files. It
does not mount or delete stored object data. The operator must approve the
intended fresh environment and inspect uncertain/partial initialization before
another attempt. Render success does not establish bucket initialization.

Default-deny NetworkPolicies permit only the original application paths:
Core→PostgreSQL/NATS/Keycloak/MinIO, Worker→NATS, Gateway→Redis,
Keycloak→PostgreSQL/Core back-channel, and initialization→MinIO. Namespace and
pod selectors are combined in the same peer. DNS is limited to the declared
CoreDNS namespace/pod labels. The application chart's five ExternalName aliases
must resolve to the five `stack-*` Services in this namespace. Actual DNS,
back-channel logout, CNI enforcement and target bootstrap are unverified until
an authorized target acceptance run.

`scripts/stack-infrastructure-check.py` checks this chart through the same pinned
Helm/Kubeconform tools. It renders default and opt-in-initialization profiles,
checks persistent mounts/UIDs/secret projections/services/quotas, evaluates
declared cross-chart network paths with adversarial namespaces/components and
refuses unsafe input variants. It preserves the original application's three
signing profiles and seven mocked Terraform plans. These are manifest/schema and
declared-contract checks, without cluster credentials or apply. Use the exact
source revision's CI evidence to determine which checks have actually passed.

References: [StatefulSet PVC retention](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/#persistentvolumeclaim-retention),
[NetworkPolicy peer selectors](https://kubernetes.io/docs/concepts/services-networking/network-policies/#behavior-of-to-and-from-selectors).
