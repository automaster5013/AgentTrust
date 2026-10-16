# Public OIDC review boundary

The Console now exposes exactly `POST /backend/logout/connect/back-channel/keycloak`.
It forwards one bounded form `logout_token` through Gateway to Spring Security's
existing OIDC back-channel handler. Form syntax is not authentication: Core must
validate the provider-signed token, issuer, audience and session binding.

This server-to-server receiver does not require a browser Origin, session cookie
or CSRF token. It never forwards those headers, authorization headers, arbitrary
paths, caller-selected upstreams, response cookies, redirects or upstream bodies.
All other browser mutations retain their existing Origin and CSRF checks. Gateway
uses a separate shared anonymous quota, refuses duplicate/extra form fields and
limits the body to 16 KiB. It does not retry a POST. Quota exhaustion or a receiver
failure can delay logout; operator delivery/retry monitoring remains necessary.

In `local-review`, only the configured loopback public Host and the fixed fixture
Host `stack-console:3000` can reach this receiver. The latter is a local isolated
development allowance. `https-review` permits only the configured public Host.
Core and Gateway use the same `agenttrust.oidc.profile`,
`agenttrust.oidc.application-origin` and `agenttrust.oidc.public-issuer` settings
(Spring environment aliases `AGENTTRUST_OIDC_PROFILE`,
`AGENTTRUST_OIDC_APPLICATION_ORIGIN`, `AGENTTRUST_OIDC_PUBLIC_ISSUER`). Gateway login
redirect validation binds to those operator settings, rather than a forwarded Host
or hard-coded loopback issuer. Console images must be built with the matching
`NEXT_PUBLIC_STACK_*` profile and origins; changing runtime values alone cannot
change embedded client configuration.

Configure an operator-owned provider's back-channel logout URL to
`https://<application-host>/backend/logout/connect/back-channel/keycloak` only
after TLS, routing, provider audience and real session-revocation acceptance have
been verified on that target. This change does not update the existing local
realm, issue production credentials or authorize deployment.

`python scripts/stack-public-identity-recovery.py --execute` is a destructive-to-its-
own-fixture development acceptance test: it briefly cold-snapshots the existing
transition stack, restores the same source containers, creates an isolated
portless clone, and changes only that clone's client logout receiver. Real
Keycloak signed logout must invalidate one matching application session while a
foreign session remains authenticated; an unsigned form must fail. The test
restores its cloned client settings, closes its sessions and deletes its owned
fixture and temporary secret copies. It is not proof of external HTTPS, a customer
IdP, delivery retries, HA, operational backup or production readiness.

Protocol reference: [OpenID Connect Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html).

## Synthetic HTTPS delivery profile

The isolated HTTPS acceptance fixture uses a private, temporary CA and three fixed
example hosts. Chromium verifies certificates and hostnames while exercising four
native accounts and four prelinked accounts in a separate synthetic enterprise
provider. A valid but unlinked external account with a colliding native email must
be refused. The fixture checks roles, tenant separation, session termination and
unchanged native identities and attributes. Its seeded read witnesses are not an
end-to-end customer evaluation and approval pilot.

The separate `--with-enterprise-pilot` gate starts fresh tmpfs NATS, Python worker
and OPA processes on that fixture's internal network. Four federated sessions
submit actual synthetic pass, block, missing-evidence and error evaluations.
Only a passing evaluation can receive administrator approval; editor/viewer
reviews and foreign reads/reviews must fail. Administrator revocation must block
the gate again. All created evaluations belong only to the disposable database;
no deployment, paid inference or customer pilot is performed. The schema 7
profile projection also binds these three process image IDs to the signed bundle.

The `console-https` image embeds the fixed `https-review` origins at build time.
The main release workflow publishes it alongside the existing fifteen images,
executes its exact registry digest in the temporary browser fixture, scans its
whole image, and signs its digest and CycloneDX attestation. Schema 7 delivery
bundles require all sixteen images and the bounded `https-profile-runtime.json`
projection. The independent consumer verifies the profile's image and dependency
IDs, evidence checksum, all sixteen digest signatures and all sixteen SBOM
attestations. Missing profile evidence, a schema downgrade or a changed dependency
must fail verification. Historical schemas retain their original image sets.

These are release gates, not a claim that a particular commit has passed them.
The synthetic profile does not configure a customer domain, public DNS, production
CA or real enterprise IdP. Those target-specific acceptance checks and actual
production deployment remain pending. No host trust store is modified.
