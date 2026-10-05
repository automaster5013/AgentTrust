CREATE INDEX runs_project_history ON agenttrust.runs(organization_id,project_id,created_at DESC,id DESC);
