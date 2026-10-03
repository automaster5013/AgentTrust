ALTER TABLE agenttrust.runs ADD CONSTRAINT runs_project_identity UNIQUE(organization_id,project_id,id);
CREATE TABLE agenttrust.run_reviews (
  id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,run_id uuid NOT NULL,actor_id uuid NOT NULL,
  decision text NOT NULL CHECK(decision IN ('approved','rejected')),
  payload jsonb NOT NULL,review_hash text NOT NULL CHECK(review_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[a-zA-Z0-9_-]{8,100}$'),
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,
  FOREIGN KEY(organization_id,project_id,run_id) REFERENCES agenttrust.runs(organization_id,project_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES agenttrust.memberships(organization_id,id),
  UNIQUE(organization_id,project_id,actor_id,idempotency_key)
);
ALTER TABLE agenttrust.run_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.run_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_run_reviews ON agenttrust.run_reviews TO agenttrust_api
  USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid)
  WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON agenttrust.run_reviews TO agenttrust_api;
CREATE TRIGGER immutable_review BEFORE UPDATE OR DELETE ON agenttrust.run_reviews
  FOR EACH ROW EXECUTE FUNCTION agenttrust.protect_receipt();
CREATE INDEX run_review_latest ON agenttrust.run_reviews(organization_id,project_id,run_id,created_at DESC,id DESC);
