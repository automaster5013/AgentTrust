CREATE TABLE stack_campaign_receipts (
 id UUID PRIMARY KEY,
 campaign_id UUID NOT NULL,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 idempotency_key VARCHAR(100) NOT NULL,
 request_hash VARCHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 key_id VARCHAR(64) NOT NULL CHECK (key_id ~ '^[a-f0-9]{64}$'),
 payload_base64 TEXT NOT NULL CHECK (length(payload_base64) BETWEEN 4 AND 22000),
 payload_sha256 VARCHAR(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
 payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 1 AND 16384),
 signature_base64 VARCHAR(88) NOT NULL CHECK (signature_base64 ~ '^[A-Za-z0-9+/]{86}==$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (organization_id,project_id,campaign_id,idempotency_key),
 FOREIGN KEY (campaign_id,organization_id,project_id) REFERENCES stack_campaigns(id,organization_id,project_id),
 FOREIGN KEY (campaign_id) REFERENCES stack_campaign_archives(campaign_id)
);
CREATE INDEX stack_campaign_receipts_scope ON stack_campaign_receipts(organization_id,project_id,campaign_id,created_at DESC,id DESC);
ALTER TABLE stack_campaign_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_campaign_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_campaign_receipts ON stack_campaign_receipts TO agenttrust_stack_api USING (
 organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid
 AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid
) WITH CHECK (
 organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid
 AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid
);
REVOKE ALL ON stack_campaign_receipts FROM PUBLIC;
GRANT SELECT,INSERT ON stack_campaign_receipts TO agenttrust_stack_api;
