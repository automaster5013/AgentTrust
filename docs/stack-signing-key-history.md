# Development observation signing-key history

The active Ed25519 key still comes from the stable `stack-gate-key-pair` secret.
`GET /api/gate-trust` still returns only its five existing public fields. Signing
always uses that active private key. Existing configuration and stored receipt
bytes do not change automatically.

An optional read-only `stack-gate-retired-keys` secret contains operator-owned
public history. Its JSON contract is `schemaVersion: 1` and a `keys` array of at
most sixteen entries, each containing exactly `keyId`, `publicKeySpkiBase64` and
`status`. The key ID must equal SHA-256 of the canonical 44-byte Ed25519 SPKI.
Status is `retired` or `revoked`. Private material, the active key, duplicates,
other algorithms, malformed/oversized JSON, duplicate JSON fields and trailing
documents are refused at startup. Input is read with a byte bound, including
projected Kubernetes secret files; startup never logs the private key contents.

Retired keys verify historical observations but cannot sign new ones. Revoked
keys neither verify nor appear in the public lookup. Stored immutable rows are
preserved: reading a receipt or bundle that no longer verifies returns 503.
Revoking the active key requires replacing the active pair first; listing the
same key as both active and historical is an invalid configuration.

Revocation here is enforced by the online service. An offline verifier using a
previously pinned public key cannot learn a later revocation from old bundle
bytes. Its signature may remain mathematically valid; it supplies neither fresh
trust status nor current deployment permission. Production acceptance still
requires a defined trust freshness and revocation-distribution policy.

`GET /api/gate-trust/keys/{64-lowercase-hex-key-id}` is authenticated and subject
to the gateway's protected-route quota. It returns the same five public fields
for an active or trusted retired key. Unknown/revoked IDs return 404. No public
key enrollment or writable route exists. Historical receipt display and bundle
download resolve trust by the receipt's validated key ID. Fresh challenged gate
checks continue to use the active-key endpoint. Browser signature and complete
scope/archive checks remain mandatory.

The Compose overlay `compose.stack.key-rotation.yaml` is opt-in. Operators supply
`.local/stack/gate-keys/retired-public-keys.json` and the exact marker
`.local/stack/gate-key-rotation-enabled` containing
`local-development-public-key-archive-v1`. No command creates or replaces an
existing installation's private signing key. Before a real operational rotation,
separate custody, historical trust policy, revocation decisions and recovery
procedures must be approved and tested in the chosen environment.

`python scripts/stack-coherent-recovery.py --execute --exercise-key-rotation`
exercises the actual behavior only in a disposable portless restored stack. It
generates a fresh fixture pair with `GateKeyTool`, replaces only owned fixture
secret bytes, restarts the fixture Core API, verifies old receipts and new
signatures, then revokes the old public key and verifies refusal of the old
receipt/bundle while the new-key receipt remains readable. Original secrets and
business rows are compared and preserved, and fixture private material is removed.
Source and registry CI run the same rehearsal; inspect the exact revision's
summary before claiming it passed.

This is development observation-key lifecycle support. It does not implement
production KMS/HSM signing, enterprise OIDC-provider key rotation, a signed key
transparency log, production trust establishment or deployment authorization.
`productionKey` and `currentDeploymentAuthority` remain false.
