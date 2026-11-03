CREATE TABLE stack_project_settings (
 organization_id UUID NOT NULL, project_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision>0),
 actor_id UUID NOT NULL, name VARCHAR(80) NOT NULL CHECK(length(btrim(name))>0), description VARCHAR(500) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,project_id,revision)
);
CREATE TABLE stack_access_keys (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, project_id UUID NOT NULL, actor_id UUID NOT NULL,
 name VARCHAR(80) NOT NULL CHECK(length(btrim(name))>0), secret_hash CHAR(64) NOT NULL CHECK(secret_hash ~ '^[a-f0-9]{64}$'),
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id,project_id), CHECK(expires_at>created_at AND expires_at<=created_at+interval '31 days')
);
CREATE TABLE stack_access_key_revocations (
 key_id UUID PRIMARY KEY, organization_id UUID NOT NULL, project_id UUID NOT NULL, actor_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(key_id,organization_id,project_id) REFERENCES stack_access_keys(id,organization_id,project_id)
);
DO $$ DECLARE item TEXT; BEGIN
 FOREACH item IN ARRAY ARRAY['stack_project_settings','stack_access_keys','stack_access_key_revocations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',item);
  EXECUTE format('CREATE POLICY scoped_records ON %I FOR ALL TO agenttrust_stack_api USING (organization_id=NULLIF(current_setting(''agenttrust.organization_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''agenttrust.project_id'',true),'''')::uuid) WITH CHECK (organization_id=NULLIF(current_setting(''agenttrust.organization_id'',true),'''')::uuid AND project_id=NULLIF(current_setting(''agenttrust.project_id'',true),'''')::uuid)',item);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO agenttrust_stack_api',item);
 END LOOP;
END $$;
