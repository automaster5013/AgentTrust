CREATE SCHEMA IF NOT EXISTS agenttrust;
REVOKE ALL ON SCHEMA agenttrust FROM PUBLIC;
GRANT USAGE ON SCHEMA agenttrust TO agenttrust_api, agenttrust_worker;
CREATE TABLE agenttrust.organizations (
  id uuid PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100)
);
CREATE TABLE agenttrust.memberships (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES agenttrust.organizations(id),
  name text NOT NULL, role text NOT NULL CHECK (role IN ('admin','editor','viewer')),
  active boolean NOT NULL DEFAULT true, UNIQUE(organization_id, id)
);
CREATE TABLE agenttrust.credentials (
  id uuid PRIMARY KEY, membership_id uuid NOT NULL REFERENCES agenttrust.memberships(id),
  token_hash text UNIQUE NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agenttrust.sessions (
  token_hash text PRIMARY KEY, credential_id uuid NOT NULL REFERENCES agenttrust.credentials(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agenttrust.projects (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES agenttrust.organizations(id),
  name text NOT NULL, UNIQUE(organization_id, id)
);
CREATE TABLE agenttrust.versions (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('agent','dataset','policy')),
  data jsonb NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id, project_id) REFERENCES agenttrust.projects(organization_id,id),
  UNIQUE(organization_id,project_id,id)
);
CREATE TABLE agenttrust.runs (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
  agent_version_id uuid NOT NULL, dataset_version_id uuid NOT NULL, policy_version_id uuid NOT NULL,
  idempotency_key text NOT NULL, fingerprint text NOT NULL,
  snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed','cancelled','timed_out')),
  timeout_ms integer NOT NULL CHECK(timeout_ms BETWEEN 100 AND 120000),
  case_budget integer NOT NULL CHECK(case_budget BETWEEN 1 AND 100),
  max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 5),
  attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz,
  deadline timestamptz NOT NULL, outcome jsonb, result_hash text,
  FOREIGN KEY(organization_id, project_id) REFERENCES agenttrust.projects(organization_id,id),
  FOREIGN KEY(organization_id, project_id, agent_version_id) REFERENCES agenttrust.versions(organization_id,project_id,id),
  FOREIGN KEY(organization_id, project_id, dataset_version_id) REFERENCES agenttrust.versions(organization_id,project_id,id),
  FOREIGN KEY(organization_id, project_id, policy_version_id) REFERENCES agenttrust.versions(organization_id,project_id,id),
  UNIQUE(organization_id, project_id, idempotency_key), UNIQUE(organization_id,id)
);
CREATE INDEX runs_queue ON agenttrust.runs(created_at) WHERE state IN ('queued','running');
CREATE TABLE agenttrust.audit_events (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES agenttrust.organizations(id),
  actor_id uuid, action text NOT NULL, resource_id uuid, detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agenttrust.usage_events (
  organization_id uuid NOT NULL, run_id uuid NOT NULL, attempts integer NOT NULL,
  evaluated_cases integer NOT NULL CHECK(evaluated_cases >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,run_id),
  FOREIGN KEY(organization_id,run_id) REFERENCES agenttrust.runs(organization_id,id)
);
CREATE FUNCTION agenttrust.protect_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state NOT IN ('queued','running') THEN RAISE EXCEPTION 'Terminal runs are immutable'; END IF;
  IF (NEW.organization_id,NEW.project_id,NEW.agent_version_id,NEW.dataset_version_id,NEW.policy_version_id,
      NEW.idempotency_key,NEW.fingerprint,NEW.snapshot,NEW.snapshot_hash,NEW.timeout_ms,NEW.case_budget,NEW.max_attempts,NEW.deadline,NEW.created_at)
     IS DISTINCT FROM
     (OLD.organization_id,OLD.project_id,OLD.agent_version_id,OLD.dataset_version_id,OLD.policy_version_id,
      OLD.idempotency_key,OLD.fingerprint,OLD.snapshot,OLD.snapshot_hash,OLD.timeout_ms,OLD.case_budget,OLD.max_attempts,OLD.deadline,OLD.created_at)
  THEN RAISE EXCEPTION 'Run snapshot and configuration are immutable'; END IF;
  IF NEW.state = 'queued' AND OLD.state = 'running' THEN RAISE EXCEPTION 'Invalid state transition'; END IF;
  IF NEW.state NOT IN ('queued','running') AND (NEW.outcome IS NULL OR NEW.completed_at IS NULL OR NEW.result_hash IS NULL)
  THEN RAISE EXCEPTION 'Terminal result evidence required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_run BEFORE UPDATE ON agenttrust.runs FOR EACH ROW EXECUTE FUNCTION agenttrust.protect_run();

-- API connections cannot bypass tenant policies. Worker is a separate trusted queue principal.
ALTER TABLE agenttrust.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_projects ON agenttrust.projects TO agenttrust_api USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_versions ON agenttrust.versions TO agenttrust_api USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_runs ON agenttrust.runs TO agenttrust_api USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_audit ON agenttrust.audit_events TO agenttrust_api USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_usage ON agenttrust.usage_events TO agenttrust_api USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT ON agenttrust.organizations,agenttrust.memberships,agenttrust.credentials TO agenttrust_api;
GRANT SELECT,INSERT,DELETE ON agenttrust.sessions TO agenttrust_api;
GRANT SELECT ON agenttrust.projects TO agenttrust_api;
GRANT SELECT,INSERT ON agenttrust.versions,agenttrust.runs,agenttrust.audit_events,agenttrust.usage_events TO agenttrust_api;
GRANT UPDATE(state,completed_at,outcome,result_hash,lease_token,lease_until) ON agenttrust.runs TO agenttrust_api;
GRANT SELECT,UPDATE ON agenttrust.runs TO agenttrust_worker;
GRANT SELECT,INSERT ON agenttrust.audit_events,agenttrust.usage_events TO agenttrust_worker;
