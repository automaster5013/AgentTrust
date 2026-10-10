CREATE TABLE stack_agent_versions (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 resource_key VARCHAR(64) NOT NULL,
 version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 1000000),
 content_json TEXT NOT NULL CHECK (octet_length(content_json) BETWEEN 1 AND 4096),
 content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (organization_id,project_id,resource_key,version),
 UNIQUE (id,organization_id,project_id)
);
CREATE TABLE stack_dataset_versions (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 resource_key VARCHAR(64) NOT NULL,
 version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 1000000),
 content_json TEXT NOT NULL CHECK (octet_length(content_json) BETWEEN 1 AND 8192),
 content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (organization_id,project_id,resource_key,version),
 UNIQUE (id,organization_id,project_id)
);
CREATE TABLE stack_campaigns (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 idempotency_key VARCHAR(100) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 agent_version_id UUID NOT NULL,
 dataset_version_id UUID NOT NULL,
 agent_content_sha256 CHAR(64) NOT NULL,
 dataset_content_sha256 CHAR(64) NOT NULL,
 requires_approval BOOLEAN NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (organization_id,project_id,idempotency_key),
 UNIQUE (id,organization_id,project_id),
 FOREIGN KEY (agent_version_id,organization_id,project_id) REFERENCES stack_agent_versions(id,organization_id,project_id),
 FOREIGN KEY (dataset_version_id,organization_id,project_id) REFERENCES stack_dataset_versions(id,organization_id,project_id)
);
CREATE TABLE stack_campaign_cases (
 campaign_id UUID NOT NULL,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 case_index INTEGER NOT NULL CHECK (case_index BETWEEN 0 AND 7),
 case_id VARCHAR(64) NOT NULL,
 required BOOLEAN NOT NULL,
 run_id UUID NOT NULL UNIQUE,
 PRIMARY KEY (campaign_id,case_index),
 UNIQUE (campaign_id,case_id),
 FOREIGN KEY (campaign_id,organization_id,project_id) REFERENCES stack_campaigns(id,organization_id,project_id),
 FOREIGN KEY (run_id,organization_id,project_id) REFERENCES stack_runs(id,organization_id,project_id)
);
CREATE TABLE stack_campaign_reviews (
 id UUID PRIMARY KEY,
 campaign_id UUID NOT NULL,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved','rejected')),
 reason VARCHAR(500) NOT NULL,
 policy_version VARCHAR(40) NOT NULL,
 policy_digest VARCHAR(71) NOT NULL,
 review_sequence BIGINT GENERATED ALWAYS AS IDENTITY,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY (campaign_id,organization_id,project_id) REFERENCES stack_campaigns(id,organization_id,project_id)
);
CREATE INDEX stack_campaigns_scope ON stack_campaigns(organization_id,project_id,created_at DESC,id DESC);
CREATE INDEX stack_campaign_reviews_latest ON stack_campaign_reviews(campaign_id,review_sequence DESC);
DO $$
DECLARE table_name TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['stack_agent_versions','stack_dataset_versions','stack_campaigns','stack_campaign_cases','stack_campaign_reviews'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY scoped_records ON %I FOR ALL TO agenttrust_stack_api USING (organization_id=NULLIF(current_setting(''agenttrust.organization_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''agenttrust.project_id'',true),'''')::uuid) WITH CHECK (organization_id=NULLIF(current_setting(''agenttrust.organization_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''agenttrust.project_id'',true),'''')::uuid)',table_name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',table_name);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO agenttrust_stack_api',table_name);
 END LOOP;
END $$;
GRANT USAGE ON SEQUENCE stack_campaign_reviews_review_sequence_seq TO agenttrust_stack_api;
