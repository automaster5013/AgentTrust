ALTER TABLE stack_runs DROP CONSTRAINT stack_runs_state_check;
ALTER TABLE stack_runs ADD CONSTRAINT stack_runs_state_check CHECK (state IN ('queued','succeeded','failed'));
CREATE TABLE stack_run_results (
 run_id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 state VARCHAR(20) NOT NULL CHECK (state IN ('succeeded','failed')),
 decision VARCHAR(20) NOT NULL CHECK (decision IN ('pass','block','inconclusive')),
 result JSONB NOT NULL,
 completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(run_id,organization_id,project_id) REFERENCES stack_runs(id,organization_id,project_id)
);
GRANT SELECT,INSERT ON stack_run_results TO agenttrust_stack_api;
REVOKE ALL ON stack_run_results FROM PUBLIC;
ALTER TABLE stack_run_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_run_results FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_results ON stack_run_results FOR ALL TO agenttrust_stack_api
 USING (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid)
 WITH CHECK (organization_id=NULLIF(current_setting('agenttrust.organization_id',true),'')::uuid AND project_id=NULLIF(current_setting('agenttrust.project_id',true),'')::uuid);
