ALTER TABLE stack_runs ADD CONSTRAINT stack_runs_scoped_identity UNIQUE (id,organization_id,project_id);
ALTER TABLE stack_reviews DROP CONSTRAINT stack_reviews_run_id_fkey;
ALTER TABLE stack_reviews ADD CONSTRAINT stack_reviews_scoped_run FOREIGN KEY(run_id,organization_id,project_id) REFERENCES stack_runs(id,organization_id,project_id);
