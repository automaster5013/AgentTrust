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
# Retained development keys and independent verification

The default drill still generates and deletes its temporary encryption key. Its
retained ciphertext cannot be recovered after that key is deleted. An operator
may instead pass `--retained-key-file` to `stack-coherent-recovery.py --execute`.
That file must already contain exactly 32 bytes in a separate direct subdirectory
of `C:/AgentTrust/.local` (or this checkout's `.local` on Linux). The tool never
creates, copies, changes or deletes an operator-provided key file. It checks the
key before snapshotting and verifies its bytes remain unchanged after cleanup.

On Windows, both the file and its parent must allow access only to the current
user and SYSTEM. The check reads native DACLs and changes no permissions or shell
execution policies. On Linux, both must belong to the current user; the file must
have no group/other permissions and the parent must likewise be private. Broad,
linked, missing or incorrectly sized key files are refused before stopping any
service. The backup directory and key directory must differ. Operators must keep
the key separately from the encrypted snapshot under an agreed custody policy.

Record the snapshot UUID, source revision and `encryptedManifestSha256` from the
drill in a separate trusted record. Replace the capitalized placeholders in this
fresh-process command with those recorded values:

```powershell
python scripts/stack-coherent-snapshot-verify.py --snapshot '.local/stack-coherent-recovery-SNAPSHOT_UUID' --retained-key-file '.local/operator-backup-keys/snapshot.bin' --expected-snapshot-id 'SNAPSHOT_UUID' --expected-revision 'SOURCE_SHA' --expected-manifest-sha256 'MANIFEST_SHA256'
```

The verifier authenticates the encrypted manifest and all six encrypted
components, validates all five bounded archives without extracting them, binds
the recorded eleven image IDs to the configuration, and checks ciphertext and key
bytes remain unchanged. Plaintext stays in process memory. Seven short-lived,
network-disabled cryptography containers may run; the verifier creates no
restored application containers or volumes and stops no source services.

`stack-coherent-retained-recovery.py --execute` is the separate acceptance wrapper.
It creates only its own protected fixture keys, runs the actual eleven-service
recovery using the retained-key interface, launches the verifier in a new process,
and requires a different validly protected key to fail cryptographic decryption.
It verifies the provided fixture keys survived both tools before deleting only
those generated fixture keys. CI runs this wrapper for source and exact registry
images, preserving safe positive and intentional-negative JSON diagnostics.
The negative control requires the crypto helper's specific AES-GCM authentication
error. An unavailable Docker engine or another helper failure cannot count as a
successfully rejected wrong key.
If the source restoration fails or the child result cannot establish that it
restored the source, the wrapper retains its generated keys in the protected
fixture directory and reports that source recovery needs attention. It does not
delete recovery material under an unknown source state.

The local contracts cover wrong keys, modified ciphertext even with a recomputed
outer digest, substituted snapshot/revision/configuration, duplicate JSON fields,
separation of keys and backups, and broad key permissions. This development
acceptance does not establish an operational backup, external key custody, KMS,
offsite retention, full-system recovery, HA or agreed RPO/RTO. An encrypted
snapshot and its key on one developer machine do not satisfy those release gates.

The stopped Compose migration task is not an additional running recovery service.
A cold database snapshot already contains the migrated schema. The eleven-service
restore starts Core with only its restricted database credentials and performs its
startup role check; it does not rerun owner migrations inside the API. Encrypted
database configuration still contains the database's own bootstrap credential.
The migration image is the already recorded Core image. Schema upgrades after a
restore require the separate migration process and the operator's controlled
upgrade procedure.


## Online supplemental recovery verification (2026-10-31)

Operating services remain online. These opt-in tools require `--execute` but
only create labeled disposable fixtures; they do not invoke the operating CD
executor or relax its backup, approval, freshness or full-stack proof gates.
Private captures and keys stay under ignored `.local`, encrypted and separated.
A development key on the same disk is not independent backup custody.

- `stack-model-cache-recovery.py` binds a signed/public candidate and copies the
  immutable read-only model volume in authenticated 16 MiB chunks (1 GiB bound).
  All chunks authenticate before target writes; hashes, modes and internal
  aliases are checked. A separate verifier authenticates retained ciphertext.
  Only the restored owned volume is used for network-disabled model startup and
  bounded offline inference. Cache restoration alone never proves inference.
- `stack-tempo-history-recovery.py` selects up to three closed blocks older than
  twenty minutes (beyond the default recent/live-only search window), excludes live WAL, restores exact hashes/modes and queries the
  published candidate. Historical trace spans must match the source readback.
  Selection is deliberately bounded: the source contains about 6.57 GB of closed
  blocks across 156,743 files. This is not full Tempo history or WAL recovery.
  The read probe uses fixed loopback HTTP inside the validated target namespace,
  without assuming the service image contains curl or wget.
- `stack-grafana-history-recovery.py` uses native SQLite read-only online backup,
  integrity verification and an isolated instance of the preserved source image.
  Provisioned dashboards/datasources are reconstructed from hash-checked source
  configuration, separately from saved SQLite rows. An empty saved dashboard
  table must not be presented as recovered user dashboard history.
- `stack-consistency-window.py` reads business hashes, migration ledger, pinned
  object references and queue positions before/after exact S3 version readback.
  The actual run verified all 774 referenced object versions, 18 business tables,
  two stream states and zero pending work without drift. This proves observed
  conservation over that window, not atomic snapshots across stores. Identity DB
  alignment, unpersisted Redis memory, active telemetry WAL and interleavings
  between reads remain outside this proof.

Tests cover chunk corruption/wrong keys before writes, ordering/path/offset
refusals, internal alias boundaries, closed-block selection, semantic trace
identity, SQLite backup, metadata mismatch and cross-store drift. CI runs the
new helper contracts in the pinned networkless security image. The older host
orchestration suites require a writable repository root and run on the host.

Signed Docker Hub publication, PR CI, isolated recovery and operating deployment
are separate facts. No online supplemental report sets full-stack recovery,
operational backup or automatic deployment to true. Prometheus/Loki recovery,
complete telemetry WAL/history, coherent cross-store backup custody and reviewed
operating transition remain release gates until separately evidenced.

Tempo selection uses the backend query cutoff described in [Grafana polling documentation](https://grafana.com/docs/tempo/latest/configuration/polling/). Recent blocks alone can return no traces while search still targets live stores; an empty result is a failed recovery proof.
