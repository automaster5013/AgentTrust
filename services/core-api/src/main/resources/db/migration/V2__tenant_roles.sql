GRANT USAGE ON SCHEMA public TO agenttrust_stack_api;
GRANT SELECT,INSERT ON stack_runs,stack_reviews,stack_audit TO agenttrust_stack_api;
REVOKE ALL ON stack_runs,stack_reviews,stack_audit FROM PUBLIC;
ALTER TABLE stack_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE stack_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE stack_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_runs ON stack_runs FOR ALL TO agenttrust_stack_api
 USING (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid)
 WITH CHECK (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid);
CREATE POLICY scoped_reviews ON stack_reviews FOR ALL TO agenttrust_stack_api
 USING (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid)
 WITH CHECK (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid);
CREATE POLICY scoped_audit ON stack_audit FOR ALL TO agenttrust_stack_api
 USING (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid)
 WITH CHECK (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid);
