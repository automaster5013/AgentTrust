ALTER TABLE stack_runs ADD COLUMN provider VARCHAR(30) NOT NULL DEFAULT 'synthetic'
 CHECK(provider IN ('synthetic','ollama','openai','openai-compatible'));
CREATE TABLE stack_provider_attempts (
 run_id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 provider VARCHAR(30) NOT NULL CHECK(provider IN ('ollama','openai','openai-compatible')),
 reserved_input_tokens INTEGER NOT NULL DEFAULT 256 CHECK(reserved_input_tokens=256),
 reserved_output_tokens INTEGER NOT NULL DEFAULT 128 CHECK(reserved_output_tokens=128),
 reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 budget_day DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
 FOREIGN KEY(run_id,organization_id,project_id) REFERENCES stack_runs(id,organization_id,project_id)
);
CREATE INDEX stack_provider_attempts_budget ON stack_provider_attempts(organization_id,project_id,budget_day);
ALTER TABLE stack_provider_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_provider_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_provider_attempts ON stack_provider_attempts USING (
 organization_id::text=current_setting('agenttrust.organization_id',true)
 AND project_id::text=current_setting('agenttrust.project_id',true)
) WITH CHECK (
 organization_id::text=current_setting('agenttrust.organization_id',true)
 AND project_id::text=current_setting('agenttrust.project_id',true)
);
REVOKE ALL ON stack_provider_attempts FROM PUBLIC;
GRANT SELECT,INSERT ON stack_provider_attempts TO agenttrust_stack_api;
