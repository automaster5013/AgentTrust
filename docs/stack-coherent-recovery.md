# Coherent business-critical recovery rehearsal

`python scripts/stack-coherent-recovery.py` performs a read-only preflight.
`python scripts/stack-coherent-recovery.py --execute` rehearses a bounded cold
recovery of the original Java/Python/TypeScript stack. It never restores over an
existing database or volume and never publishes fixture ports.

The preflight verifies eleven existing AgentTrust transition containers, their
nonroot image identities, private read-only file mounts, the five exact state
volumes and absence of pending evaluations. It requires the pinned encryption
tool and archive helper images before stopping anything. On Windows it reserves
22 GiB plus 1 GiB rehearsal headroom; each fixture startup checks again.

The console, gateway, worker and Core API stop before Keycloak, MinIO, NATS,
Redis and PostgreSQL. Pending evaluations are checked again after Core stops.
All writers and all five stateful services remain stopped while their snapshots
are captured. This is a cold consistency point, not a live atomic snapshot or a
zero-downtime backup. PostgreSQL's entire cluster volume includes both the
application and Keycloak databases, roles and WAL. This follows the
[PostgreSQL filesystem backup requirement](https://www.postgresql.org/docs/current/backup-file.html)
to stop the database and preserve the complete cluster.

Each compressed volume and the private runtime configuration are encrypted
with AES-256-GCM without plaintext archive files on the host. An authenticated
manifest binds the snapshot UUID, source revision, eleven exact image/container
identities and all six encrypted component digests and sizes. All components
must authenticate and match before any fixture resources are created. Archive
validation refuses traversal, absolute/Windows paths, links, devices, duplicate
normalized paths and privileged permissions, with compressed, expanded, member
and per-file size bounds.

The same original containers are started and checked before fixture work. Fresh
UUID-labelled volumes receive only validated bytes, and every restored file's
hash, size and permissions are compared before startup. Eleven exact-image
services then start on one new internal network with no published ports. Paid
providers and fixture telemetry are disabled. Application credentials and
development signing keys come from the authenticated configuration snapshot.
The fixture never mounts original writable volumes or contacts original service
network aliases.

Before any fixture API request, every application business-table fingerprint
must match the frozen source. A test-only transport maps the original loopback
URLs to fixed service aliases inside the fixture network, preserving URL, Host,
issuer, PKCE redirect and cookie contracts. It cannot route other ports, external
hosts, HTTPS or proxy tunnels. This transport is not installed in the product.

The recovered application must demonstrate:

- Actual Keycloak authorization-code/PKCE login and logout for owned sessions.
- Exact pre-snapshot campaign and child object versions with verified bytes.
- Historical receipt and fresh challenged Ed25519 signature verification against
  a public key anchored separately before snapshot creation.
- Viewer write refusal and foreign-organization read refusal.
- A fresh synthetic evaluation through recovered NATS/Python/Java, approval hold,
  administrator approval, idempotent resubmission and verified archived bytes.

New business rows are created only in the disposable restored database. Original
business fingerprints, container IDs and image IDs must remain unchanged. The
rehearsal removes only its UUID-labelled containers, volumes, network and temporary
private files. Cleanup failure means failure. Encryption keys are temporary and
removed, so retained ciphertext is **not** a usable operational backup.

## Verified scope and remaining acceptance

The 2026-10-15 KST local rehearsal passed all six orchestration checks and four
restored application checks with all 18 source business tables unchanged.
Source and exact-registry CI rehearsals are configured; completion must be read
from the CI results for the corresponding source revision. Only the safe summary
is uploaded, never private configuration, archive bytes or recovery keys.

This verifies business-critical **development** recovery. It excludes observability
history and the local model download cache, external infrastructure, production
KMS and offsite backup custody, HA, operational RPO/RTO, customer workload and
deployment authorization. Those remain release acceptance items. Process/host
termination during rehearsal can require inspecting the last safe summary and
explicitly recovering original containers or cleaning owned fixtures; automatic
cleanup after arbitrary host loss is not promised.

Optional [development key rotation](stack-signing-key-history.md) and
[twenty-evaluation recovery/metadata latency](stack-recovery-load.md) phases use
the same disposable stack. Their flags do not claim success until the actual
per-revision summary records the corresponding checks and cleanup as passed.
