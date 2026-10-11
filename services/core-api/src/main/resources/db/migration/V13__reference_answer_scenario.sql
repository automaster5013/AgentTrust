-- Append a new bounded campaign mode; historical admissions and schemas remain intact.
ALTER TABLE stack_runs DROP CONSTRAINT stack_runs_scenario_check;
ALTER TABLE stack_runs ADD CONSTRAINT stack_runs_scenario_check
 CHECK (scenario IN ('pass','block','missing_evidence','error','quality'));
