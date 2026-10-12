CREATE TABLE stack_agent_version_retirements (
 version_id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 reason VARCHAR(500) NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY (version_id,organization_id,project_id) REFERENCES stack_agent_versions(id,organization_id,project_id)
);
CREATE TABLE stack_dataset_version_retirements (
 version_id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 reason VARCHAR(500) NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY (version_id,organization_id,project_id) REFERENCES stack_dataset_versions(id,organization_id,project_id)
);
DO $$
DECLARE table_name TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['stack_agent_version_retirements','stack_dataset_version_retirements'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY scoped_records ON %I FOR ALL TO agenttrust_stack_api USING (organization_id=NULLIF(current_setting(''agenttrust.organization_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''agenttrust.project_id'',true),'''')::uuid) WITH CHECK (organization_id=NULLIF(current_setting(''agenttrust.organization_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''agenttrust.project_id'',true),'''')::uuid)',table_name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',table_name);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO agenttrust_stack_api',table_name);
 END LOOP;
END $$;
