# Evaluation path readiness

The authenticated `GET /api/evaluation-readiness` observes the current scoped PostgreSQL connection, Python evaluation consumers and OPA decision entrypoint. It returns 200 only if all three observations succeed; otherwise it returns a scoped, structured 503. Both `productionReady` and `deploymentAuthority` are always false. It does not run a model, reserve provider capacity, enqueue an evaluation, record an approval or write business data.

The database check uses the existing restricted application connection and organization/project transaction settings. It refuses a superuser, RLS bypass, role/database creation, replication or membership in the migration superuser role. It does not independently re-certify every RLS policy; the integration boundary tests provide that evidence.

A separate Python operations wrapper preserves the versioned evaluator modules and their execution fingerprints. Its `/ready` route reads both existing JetStream consumer configurations through an independent NATS connection, under a one-second total deadline. Both evaluator task flags, connected inspection socket, fixed durable identities, subjects, explicit acknowledgements, 15-second acknowledgement wait, 20 deliveries and pending limits must match. It never creates consumers or pulls messages. Existing `/health` startup/liveness behavior remains unchanged, avoiding a circular dependency on the Java completion API.

The policy probe sends a queued, inconclusive, scoped diagnostic with one required inconclusive rule through the existing bounded OPA client. Only a bound, current-policy, evaluated inconclusive response with no deployment permission counts as available. The diagnostic is not persisted as an evaluation. Worker HTTP requests have a two-second total deadline and 1 KiB body limit; policy requests retain the existing two-second and 4 KiB limits. Failures expose no internal exception details.

The console validates the complete response schema, authenticated scope, dependency order, boolean invariants and agreement between HTTP status and readiness. It clears stale observations on refresh, failure or identity change, uses a ten-second abort deadline and accepts no caller-selected tenant or endpoint. A validated unavailable response can be displayed without presenting the old successful state.

This is a momentary dependency observation. It does not promise inference success, throughput, future queue availability, operational deployment readiness or release approval. Provider availability and production controls require separate evidence.

Validation: Python failure controls and profile tests, Java worker-response controls, TypeScript scope/status controls, real OIDC smoke and Playwright rendering. `python scripts/stack-evaluation-readiness-smoke.py --worker-interruption` additionally stops only the transition worker, with no queued jobs, verifies unavailable state, restores it and checks recovery. All public business-table fingerprints and owned session cleanup must pass. The interruption mode is explicit; ordinary CI uses read-only smoke without stopping services.

Local evidence on 2026-10-11: Python 89 tests, Java 75 tests, Gateway 20 tests and TypeScript 52 tests passed, with all four runtime images built. Actual OIDC smoke passed five checks across admin/viewer/other-organization identities, including worker stop/recovery; all 15 public business tables were unchanged and owned sessions logged out. One real-browser test verified the actual successful response, simulated dependency failure rendering and foreign-scope clearing. Remote CI for this change remains pending until its exact revision completes.

CI sequencing correction: the preceding `01a50c6` integration run failed its post-restart HTTP fixture with `429 RATE_LIMITED` after browser tests. An authenticated, digest-verified diagnostic artifact established the cause. The workflow now allows the actual 60-second project quota to expire before that fixture, without changing quota limits or deleting Redis entries. This fixes fixture isolation; the newest full CI must still complete before claiming delivery verification.

Extended actual runtime verification at source revision `15fce601ebdfba5fdf3c886a9a73f3fc27d9e221` passed nine checks. The explicit `--worker-interruption --nats-interruption --policy-interruption` mode stopped and restored each owned transition service separately with no outstanding evaluation. Only the affected dependency became unavailable; independently validated readiness recovered afterward. All 15 business tables were unchanged, owned sessions closed, and all 20 AgentTrust containers returned healthy. [Full source and registry-image CI](https://github.com/automaster5013/AgentTrust/actions/runs/38147084755) passed. These results supersede the earlier pending status above; they do not establish production readiness.

## Shared role boundary and concurrent observations

Startup and scoped database readiness use the same restricted-role predicate.
Besides direct role attributes, it rejects database/public-schema CREATE,
all membership in other roles (including predefined server-program/all-table
write roles), and direct ownership of public relations. Noninherited membership
still fails: disabling inheritance does not remove the ability to assume a role. Catalog relations and functions are explicitly qualified
with `pg_catalog`; a caller's temporary `pg_roles` cannot hide privilege drift.
The scoped variant also requires the current organization/project settings.
The database observation must successfully read the bounded V17 pending-workspace
capability; a missing capability or unsuitable function owner is unavailable.
Its namespace values are discarded and never returned by readiness.

The disposable PostgreSQL boundary fixture exercises database/schema CREATE,
inherited role administration, noninherited relation ownership, predefined
server-program/all-table write roles and temporary catalog shadowing. It changes only its own tmpfs database and verifies actual
compiled API-process rejection and recovery after each restored grant. Earlier
baseline controls demonstrated four privilege states accepted by startup and seven
database-readiness predicate false positives. The original development database's
grants are never changed by these adversarial controls.

Concurrent Python `/ready` callers may share one in-flight consumer inspection
for the same connection. Completed results are never cached: a later observation
starts new live broker reads. One disconnected HTTP reader cannot cancel a probe
other readers await; the existing one-second inspection deadline remains.
Dead evaluator flags or a disconnected socket fail immediately, and the HTTP
contract rechecks evaluator flags and the current inspection connection after the
shared await. Connection replacement cannot reuse an old connection's result.
This reduces repeated control-plane reads without claiming throughput, latency
or a production SLA from unit checks. The real application build, exact published
images and a changed-runtime observation remain separate acceptance requirements.


Backup stream privacy is accepted separately from dependency readiness. Shared
crypto and physical-volume transport helpers disable Docker log storage for
attached data streams. A disposable canary test observes actual log drivers for
encryption/decryption and compressed/uncompressed volume archives, then deliberately
enables JSON logging only for a public synthetic canary to verify that this
regression would persist plaintext. No original keys, database bytes or source
service interruptions are used by that control. Source and registry recovery
jobs run it before handling their snapshot data. Application service logging
retains its existing behavior; private backup streams are not application logs.
