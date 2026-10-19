# Gateway stage timing

The gateway records a fixed duration histogram for protected API requests. It
separates the authenticated Core identity preflight (`identity`), Redis admission
(`quota`) and the admitted request/body/response forwarding (`forward`). OAuth
redirects, public authentication routes and back-channel logout are excluded.
Anonymous and refused routes do not start these measurements. No quota, CSRF,
response, authentication or six-second request deadline is changed.

`agenttrust.gateway.stage.duration` has only two application dimensions:
`agenttrust.gateway.stage` (`identity`, `quota`, `forward`) and
`agenttrust.gateway.outcome` (`completed`, `error`, `cancelled`). There are nine
possible timer groups. Names, URLs, route parameters, account/tenant identifiers,
cookies, headers, bodies and exception text are never metric dimensions. Timing
starts when a stage is subscribed, uses the registry's monotonic clock and records
exactly one terminal outcome. A cancelled stage includes cancellation by the
unchanged outer request deadline; it does not identify the cancellation's cause.
`completed` describes publisher completion, including a completed quota denial or
an HTTP error response, and does not mean the complete request succeeded.

The pinned Java agent's Micrometer bridge is explicitly enabled for the gateway.
Spring's Micrometer allowlist enables only this application timer; the public
Actuator exposure remains `health`. The existing Collector still refuses unknown
metrics and strips resource, scope, trace, log and HTTP metadata. For this one
histogram it additionally requires the gateway service, histogram type, seconds
unit and the fixed stage/outcome values. Unknown dimensions are removed and
remaining groups are aggregated. Missing, non-string or unknown stage/outcome
values and exemplars are refused. `.max` and other bridge helper metrics are not
accepted. The private Collector network is not an authenticated telemetry trust
boundary; this filtering does not establish a trusted sender identity.

The explicit histogram bounds are 5, 25, 100, 250, 500, 1,000, 3,000 and 6,000ms,
plus the exported overflow bucket. The pinned bridge exports seconds. Example
PromQL through the existing authenticated Grafana Prometheus data source:

```promql
histogram_quantile(0.95,
  sum by (le, agenttrust_gateway_stage) (
    rate(agenttrust_gateway_stage_duration_seconds_bucket{
      service_name="agenttrust-gateway",
      agenttrust_gateway_outcome="completed"
    }[5m])
  )
)
```

These are aggregate stage histograms with finite resolution. Stage p95 values
cannot be added to reconstruct a request p95, and they omit BFF/client scheduling,
network time outside the gateway and downstream browser processing. They cannot
prove the cause of a historical tail-latency failure. A causal comparison still
needs exact image bindings, matched process age and host state, and a specific
controlled hypothesis. Low counts or changed request mixtures also limit a p95
comparison. This implementation provides measurement boundaries; it does not
claim a latency fix or a production SLO.

Java tests cover subscription timing, error preservation, cancellation/deadline,
fixed dimensions/bounds and actual controller admission/forwarding boundaries.
`scripts/stack-gateway-stage-privacy-test.py` starts an owned, temporary Collector
using the exact source metric processors, no network and no published ports.
Bounded `docker exec` requests use only that instance's loopback receiver and
Prometheus scrape endpoint. Deliberately synthetic OTLP fixtures verify that canaries,
wrong services/units/types, missing or malformed labels, unknown labels/values and
exemplars do not survive actual readback. It keeps those fixtures out of the
application's telemetry backends and verifies original runtime bindings and owned
container cleanup. `stack-observability-smoke.py` separately
requires positive **completed** application observations for all three stages and
the exact histogram bounds, excluding that fixture. Source and exact registry CI
must independently pass these checks for a release; local compilation alone
does not certify image delivery, the current development runtime or production.

References: [Micrometer timers](https://docs.micrometer.io/micrometer/reference/concepts/timers.html),
[pinned Java agent bridge](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/v2.32.0/instrumentation/micrometer/micrometer-1.5/library/src/main/java/io/opentelemetry/instrumentation/micrometer/v1_5/OpenTelemetryMeterRegistryBuilder.java).
