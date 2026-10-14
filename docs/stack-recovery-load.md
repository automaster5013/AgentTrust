# Synthetic recovered-stack capacity and latency check

`python scripts/stack-coherent-recovery.py --execute --exercise-key-rotation --exercise-load`
adds a bounded synthetic load phase to the disposable, portless recovery stack.
The default command remains read-only preflight. Original data, credentials and
service network aliases are never load-test targets.

Only the owned fixture worker stops. Twenty distinct synthetic pass evaluations
are admitted through real OIDC, console, gateway and Java at HTTP concurrency
four. Before restarting that worker, a read-only query of the fixture database
must observe all twenty without completion rows. This proves twenty simultaneous
outstanding evaluations, not twenty simultaneous model inferences or HTTP writes.

After worker startup, all twenty completion rows must appear within a bounded
observation window. Actual scoped API reads must show Python synthetic pass
results and evaluated OPA gates. Replaying every original request key must retain
the same run ID, and the completion count must remain twenty. Only the disposable
restored database receives these new rows.

The metadata phase waits for the real 60-second project quota window to expire.
It never increases quotas or deletes Redis keys. It then measures forty successful
HTTP requests on each of four routes: identity, one recovered run detail, agent
versions and provider usage. Each route has four warm-up requests, excluded and
reported separately, and HTTP concurrency four. Responses retain their expected
organization/project scope. Empirical p50/p95 use nearest-rank percentiles and
preserve all raw latency samples, including outliers. Each measured p95 must be
at most 500ms; an over-target result fails this rehearsal rather than being
silently accepted. Both source and exact-registry CI run this check and upload
only its safe summary.

The version-list endpoint intentionally returns only summary fields, without
tenant columns. Before timing it, the probe reads every listed version's scoped
detail and binds its identity, content hash and summary fields to the owned
organization/project. Timed list responses must equal that verified baseline;
the probe does not invent tenant fields absent from the actual API contract.
The JDBC list projection serializes timestamps at millisecond precision while
immutable detail retains microseconds. The detail must fall within that exact
summary millisecond; timestamps retaining finer precision must match exactly.
Neighbouring milliseconds, changed hashes and foreign scope remain failures.

The latency phase is separate from queue recovery. It measures a particular
synthetic fixture on the current host, not an agreed production workload,
customer concurrency, inference latency, sustained throughput, HA, or a commercial
SLO. All reports retain `productionSloVerified: false`. Operational acceptance
still requires the chosen infrastructure, customer traffic profile, cold-start
and sustained-load tests, monitoring/alert acceptance and an agreed SLO.

For an explicit extended rehearsal, `--load-cycles N` accepts 1 through 120.
Each cycle uses a new cohort ID, the same twenty-pending/recovery/idempotency
checks, its own natural quota wait and all 160 measured HTTP samples. The safe
summary preserves every completed cycle's raw samples and aggregate run/result
counts, and disk reserve is checked before each cycle. CI defaults to one cycle.
Between cycles the runner also lets the previous metadata quota window expire
before admitting the next cohort. This preserves the real limits across the whole
run; a 120-cycle run includes at least four hours of these natural waits.
Longer runs remain synthetic host observations, not customer or production SLOs.

Application probe containers have unique fixture names/labels and are registered
before launch, including timeout paths, so cleanup can find a timed-out probe.
Private mounted inputs must belong to that rehearsal; scripts and destinations
are fixed. Health-query timeouts recheck the same service within the original
total readiness deadline; they never trigger a service restart. Deadline expiry
or a stopped service still fails. Process/host loss remains an explicit recovery
case rather than an automatic-cleanup guarantee.
