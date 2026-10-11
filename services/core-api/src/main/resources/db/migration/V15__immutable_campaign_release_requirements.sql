CREATE TABLE stack_campaign_release_requirements (
 campaign_id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 baseline_campaign_id UUID NOT NULL,
 evidence_max_age_seconds INTEGER NOT NULL CHECK (evidence_max_age_seconds BETWEEN 60 AND 86400),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (campaign_id <> baseline_campaign_id),
 FOREIGN KEY (campaign_id,organization_id,project_id) REFERENCES stack_campaigns(id,organization_id,project_id),
 FOREIGN KEY (baseline_campaign_id,organization_id,project_id) REFERENCES stack_campaigns(id,organization_id,project_id)
);
ALTER TABLE stack_campaign_release_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_campaign_release_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_records ON stack_campaign_release_requirements FOR ALL TO agenttrust_stack_api
 USING (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid)
 WITH CHECK (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid);
REVOKE ALL ON stack_campaign_release_requirements FROM PUBLIC;
GRANT SELECT,INSERT ON stack_campaign_release_requirements TO agenttrust_stack_api;
