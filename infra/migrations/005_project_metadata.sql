ALTER TABLE agenttrust.projects ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
