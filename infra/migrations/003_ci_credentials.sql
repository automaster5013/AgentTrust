CREATE TABLE agenttrust.ci_credentials (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  CHECK(expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  FOREIGN KEY(organization_id,project_id) REFERENCES agenttrust.projects(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES agenttrust.memberships(organization_id,id),
  UNIQUE(organization_id,project_id,id)
);
ALTER TABLE agenttrust.ci_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.ci_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_ci_credentials ON agenttrust.ci_credentials TO agenttrust_api
  USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid)
  WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON agenttrust.ci_credentials TO agenttrust_api;
GRANT UPDATE(revoked_at) ON agenttrust.ci_credentials TO agenttrust_api;

-- Only this bounded token lookup runs before tenant context is available.
CREATE FUNCTION agenttrust.authenticate_ci(hash text)
RETURNS TABLE(id uuid, organization_id uuid, project_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT c.id,c.organization_id,c.project_id,c.name FROM agenttrust.ci_credentials c
  JOIN agenttrust.memberships m ON m.id=c.created_by AND m.organization_id=c.organization_id
  WHERE c.token_hash=hash AND c.revoked_at IS NULL AND c.expires_at>now() AND m.active AND m.role='admin'
$$;
REVOKE ALL ON FUNCTION agenttrust.authenticate_ci(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agenttrust.authenticate_ci(text) TO agenttrust_api;

CREATE TABLE agenttrust.release_receipts (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
  candidate_run_id uuid NOT NULL, baseline_run_id uuid,
  service_credential_id uuid, actor_id uuid,
  request jsonb NOT NULL, result jsonb NOT NULL,
  candidate_snapshot_hash text NOT NULL, candidate_result_hash text,
  baseline_snapshot_hash text, baseline_result_hash text,
  artifact_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,project_id) REFERENCES agenttrust.projects(organization_id,id),
  FOREIGN KEY(organization_id,candidate_run_id) REFERENCES agenttrust.runs(organization_id,id),
  FOREIGN KEY(organization_id,baseline_run_id) REFERENCES agenttrust.runs(organization_id,id),
  FOREIGN KEY(organization_id,project_id,service_credential_id) REFERENCES agenttrust.ci_credentials(organization_id,project_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES agenttrust.memberships(organization_id,id)
);
ALTER TABLE agenttrust.release_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.release_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_release_receipts ON agenttrust.release_receipts TO agenttrust_api
  USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid)
  WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON agenttrust.release_receipts TO agenttrust_api;
CREATE FUNCTION agenttrust.protect_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Release receipts are immutable'; END $$;
CREATE TRIGGER protect_receipt BEFORE UPDATE OR DELETE ON agenttrust.release_receipts
  FOR EACH ROW EXECUTE FUNCTION agenttrust.protect_receipt();
CREATE INDEX release_receipts_project ON agenttrust.release_receipts(organization_id,project_id,created_at DESC);
