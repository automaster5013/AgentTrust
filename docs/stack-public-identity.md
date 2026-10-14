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
