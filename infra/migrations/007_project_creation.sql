ALTER TABLE agenttrust.projects ADD COLUMN creation_key text;
ALTER TABLE agenttrust.projects ADD COLUMN creation_hash text;
ALTER TABLE agenttrust.projects ADD CONSTRAINT project_creation_key_format
  CHECK(creation_key IS NULL OR creation_key ~ '^[a-zA-Z0-9_-]{8,100}$');
ALTER TABLE agenttrust.projects ADD CONSTRAINT project_creation_hash_format
  CHECK(creation_hash IS NULL OR creation_hash ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX project_creation_key ON agenttrust.projects(organization_id,creation_key)
  WHERE creation_key IS NOT NULL;
GRANT INSERT ON agenttrust.projects TO agenttrust_api;
