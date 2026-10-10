CREATE TABLE stack_campaign_archives (
 campaign_id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 content_sha256 VARCHAR(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 object_key TEXT NOT NULL,
 version_id VARCHAR(128) NOT NULL CHECK (version_id ~ '^[A-Za-z0-9._-]{1,128}$' AND version_id <> 'null'),
 content_bytes INTEGER NOT NULL CHECK (content_bytes BETWEEN 1 AND 16384),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY (campaign_id,organization_id,project_id) REFERENCES stack_campaigns(id,organization_id,project_id),
 CHECK (object_key = 'organizations/' || organization_id::text || '/projects/' || project_id::text || '/campaigns/' || campaign_id::text || '/' || content_sha256 || '.json')
);
ALTER TABLE stack_campaign_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_campaign_archives FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_campaign_archives ON stack_campaign_archives TO agenttrust_stack_api USING (
 organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid
 AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid
) WITH CHECK (
 organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid
 AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid
);
REVOKE ALL ON stack_campaign_archives FROM PUBLIC;
GRANT SELECT,INSERT ON stack_campaign_archives TO agenttrust_stack_api;
