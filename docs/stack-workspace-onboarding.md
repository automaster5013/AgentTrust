# Operator workspace identities

`python scripts/stack-workspace-onboarding.py --manifest .local/<manifest>.json`
validates a bounded, duplicate-key-free manifest without contacting an identity
provider. The manifest contains no passwords or caller-selected server URL:

```json
{
  "schemaVersion": 1,
  "organizationId": "8f744ceb-022a-4e4e-bac1-4d4696fa3d01",
  "projectId": "b0b478c4-dc2d-4599-b338-d955b66fdc94",
  "members": [
    {"username": "example-workspace-admin", "role": "admin"},
    {"username": "example-workspace-viewer", "role": "viewer"}
  ]
}
```

Choose fresh UUIDs for a new organization/project namespace. An operator is
responsible for approving any reuse of an existing namespace. Each account has
one organization, one project and exactly one recognized workspace role. There
must be an administrator, names must be distinct and at most 20 members can be
provisioned together. This is an operator CLI, not a browser enrollment API.

Adding `--execute` provisions **only the existing loopback development Keycloak**.
The command checks the actual `agenttrust` Compose identity service, protected
claim mappers and administrator-only workspace attributes. It refuses existing
usernames before making any user mutation. It creates new users disabled, assigns
one non-composite role, verifies scopes and effective roles, and enables accounts
only after the entire disabled cohort has passed validation. Realm/client
administration mappings are refused. It does not edit existing users, create
database owner roles, change claim mappers or restart application containers.

Generated random passwords and returned provider actor ids are retained in
`.local/workspace-onboarding-<UUID>/journal.json`. The directory and journal are
private to their owner (plus SYSTEM on Windows); the CLI prints only a safe
summary and directory path. Review that journal privately. It must never be
committed, published as a CI artifact, or copied into ordinary logs. The current
development accounts use synthetic `.invalid` emails and non-temporary passwords
for automated OIDC acceptance. This is **not** a production invitation, password
delivery, customer identity verification, or enterprise IdP integration.

Provider changes are not a distributed transaction. The command never retries
creation or adopts an existing account after a lost response. On a caught failure
it attempts to disable every account whose id was returned by its own create
request and records whether containment succeeded. Unknown creations, process
termination during activation and provider unavailability require operator
reconciliation with the retained journal. It does not automatically delete
accounts, change existing passwords or claim rollback of uncertain requests.
Default plan mode does not check username availability against the provider;
execution performs that preflight immediately before mutation.

`python scripts/stack-workspace-onboarding-smoke.py` creates five fresh synthetic
accounts across two organizations and three projects. It performs actual PKCE
login through Console/Gateway/Core, verifies returned actor/role/scope, empty
workspace lists and viewer write refusal, logs out its sessions, deletes only its
known created identities, and verifies the original identities and direct role
mappings are unchanged. Local default mode creates no evaluation business rows.
`--allow-owned-evaluations` additionally exercises actual editor evaluation,
viewer read, administrator rejection, blocked gate and cross-project/organization
404s. Use that option only on a disposable acceptance environment; CI runs it
against both its source and exact published-image environments. Evaluation and
audit rows are retained inside that disposable CI database after identity cleanup.

`python scripts/stack-workspace-onboarding.py --suspend-journal .local/workspace-onboarding-<UUID>/journal.json`
reviews a completed provisioning journal without contacting the provider. With
`--execute`, it verifies the file's owner-only custody, original manifest hash and
every actor/name/organization/project/role before disabling any member. It disables
only that exact cohort and explicitly asks Keycloak to terminate each member's
provider sessions. Reassigned identities, changed roles, malformed/partial journals
and uncertain creates are refused. The original provisioning journal is retained;
a separate private operation journal records partial failure or completion.
This command never deletes accounts or automatically retries unknown logout
requests. A provider timeout may leave a partially suspended cohort and requires
operator reconciliation. Completion means all cohort accounts are disabled and
their provider session lists are empty; the CLI cannot independently prove
revocation at every relying application. The acceptance smoke separately keeps
three Core sessions open, runs this command, verifies real signed back-channel
logout makes all three return401, refuses a fresh disabled-account login and
confirms the other project and organization remain authenticated.

The first local read-only-business smoke passed on 2026-10-15. Unit controls cover
malformed manifests, duplicate fields, account collisions, privilege/scope
substitution, lost create responses, failed activation/containment and journal
failures. Thirty-one unit/transport/custody/reconciliation controls cover the implementation, including exact
journal custody and suspension scope, role, unknown-logout and remaining-session
refusal. Every release must independently pass matching source and exact registry acceptance;
local unit checks alone are insufficient. Dynamic application project selection,
browser membership management, production tenant registry, enterprise IdP lifecycle and
customer invitations remain separate release requirements.

The original dispatcher enumerated the two namespaces in the synthetic credential
file. The first disposable CI attempt demonstrated that a newly provisioned editor
could admit an evaluation that remained queued. V17 adds
`public.stack_pending_workspaces(uuid,uuid)` for bounded discovery of namespaces
with already-admitted pending work. The dispatcher reads eight namespace pairs
per keyset page, verifies PostgreSQL UUID ordering, rotates its cursor, and handles
at most 40 admissions per scheduled cycle. A restart derives pending namespaces
from durable admissions again; adding a namespace requires no credential-file edit
or application restart. Payloads, versions and results are read through their
original organization/project RLS scope. Worker callbacks retain their original
run/scenario/provider/version binding checks.

This is an intentional privileged metadata capability: the migration owner owns
a SECURITY DEFINER SQL function that returns only organization/project UUIDs.
Its relations are schema-qualified, its search path fixes pg_catalog followed by
pg_temp, PUBLIC execution is revoked and only the API role receives execution.
The function sets row_security off so an owner whose queries would be filtered
gets an error. This setting grants no RLS bypass. The evaluated database readiness
requires both the restricted API role and a successful bounded discovery read;
a missing capability or unsuitable owner is reported unavailable. The configured
development migration owner can read both source tables; the chosen production
role/policy arrangement still requires target-specific acceptance.
The JDBC statement has a two-second timeout. The API receives no table-owner
membership, BYPASSRLS privilege or owner credential. An isolated disposable
PostgreSQL fixture checks ten pending namespaces in pages8+2 across the UUID sign
boundary, exclusion of completed work, direct table RLS, refusal of PUBLIC
execution and API alteration, and resistance to a caller's temporary shadow
table. See [PostgreSQL's security-definer guidance](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).
Full source and exact registry evaluation acceptance must match the release revision. No new business table is introduced; V17 adds
the function and its migration-history entry.

Protocol reference: [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html).

## Read-only journal reconciliation

`python scripts/stack-workspace-reconcile.py --manifest .local/<original-manifest>.json --journal .local/workspace-onboarding-<UUID>/journal.json`
reviews an owner-protected provisioning journal and its exact original full
manifest without contacting the identity provider. The manifest hash, ordered
attempted members, organization/project and known actor identifiers must agree.
It accepts incomplete provisioning records for review; it never replays a create,
password, activation or logout request. It does not edit the original journal.

Adding `--inspect-local` uses only account/configuration/session reads against the
fixed development Keycloak, plus its own operator authentication and logout. It
reports aggregate enabled/disabled, changed scope/role and session counts.
Completion means inspection finished, not that provisioning recovered. Every
incomplete provisioning record still requires an operator decision, even if all
known users are disabled. Reads are not an atomic provider snapshot and do not
independently verify every application session's revocation.

If a create response was lost, an exact bounded username lookup may find a
candidate. That candidate is always unproven ownership: it is never adopted,
enabled, disabled, deleted or written back to the journal. No matching username
does not establish rollback; a rename or delayed provider action may still need
investigation. Ambiguous matches are refused. This command is an inspection tool,
not an authorization to resume or repair uncertain operations automatically.

Provisioning, suspension and known-actor reconciliation inspect effective roles
for Keycloak's `realm-management` client, including inherited composites. Checking
only direct client mappings is insufficient when a default/composite realm role
grants administration. Provisioning rejects such a cohort before activation;
suspension refuses a changed privilege boundary before any account mutation.
Reconciliation flags a known actor with that unexpected privilege for manual
review. Ordinary account-client roles are not confused with realm administration.
Owned transport controls demonstrate the previous direct-mapping gap; the actual
four existing development accounts have no effective realm-management roles.
These controls do not certify a future enterprise IdP configuration.

## Multi-workspace delivery acceptance

`python scripts/stack-workspace-dispatch-load.py` prints an offline plan and
contacts no provider or Docker service. Its write option
`--allow-owned-evaluations` requires a disposable GitHub CI job and the loopback
local-review identity profile. Source and exact registry acceptance run it there.
It creates ten owned administrator identities across two organizations and ten
fresh projects, with organization UUIDs spanning the unsigned ordering boundary.

The fixture stops only its known transition worker and admits fifty synthetic
evaluations, five per workspace. Before restarting that same container and image,
it requires the actual durable broker to hold fifty distinct published messages.
All ten namespaces remain pending during this check, exercising discovery beyond
the eight-namespace page and forty-admission cycle budget. After restoration it
requires fifty actual Python synthetic completions, blocked unreviewed gates,
other-project/organization 404s and acknowledgement of the broker work. Completed
business rows stay in the disposable acceptance database. It uses no model or
paid provider and establishes no production load or customer SLA.

Only known created identity ids are cleaned up. The entire cleanup cohort is
checked against the original account set and exact name/scope before any delete;
all original identities and role mappings must match afterward. Generated
password journals remain owner-protected and are excluded from CI artifacts.
The uploaded report contains bounded counts and flags. Seven failure/boundary
controls cover the offline plan, disposable-CI guard, namespace/broker bounds and
cleanup ownership. Full fifty-evaluation acceptance must pass independently in
both source and exact published-image environments for the release revision.
