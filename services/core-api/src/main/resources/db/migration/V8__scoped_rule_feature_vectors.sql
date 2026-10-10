CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE stack_rule_vectors (
 run_id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 content_sha256 VARCHAR(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 feature_version VARCHAR(40) NOT NULL CHECK(feature_version='rule-features-v1'),
 embedding vector(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(run_id,organization_id,project_id) REFERENCES stack_runs(id,organization_id,project_id),
 FOREIGN KEY(run_id) REFERENCES stack_run_results(run_id),
 CHECK(vector_norm(embedding) BETWEEN 0.999 AND 1.001)
);
CREATE INDEX stack_rule_vectors_scope ON stack_rule_vectors(organization_id,project_id);
ALTER TABLE stack_rule_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_rule_vectors FORCE ROW LEVEL SECURITY;
CREATE POLICY stack_rule_vectors_scope ON stack_rule_vectors USING (
 organization_id::text=current_setting('agenttrust.organization_id',true)
 AND project_id::text=current_setting('agenttrust.project_id',true)
) WITH CHECK (
 organization_id::text=current_setting('agenttrust.organization_id',true)
 AND project_id::text=current_setting('agenttrust.project_id',true)
);
REVOKE ALL ON stack_rule_vectors FROM PUBLIC;
GRANT SELECT,INSERT ON stack_rule_vectors TO agenttrust_stack_api;
