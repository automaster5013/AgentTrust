CREATE TABLE stack_runs (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 idempotency_key VARCHAR(100) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 scenario VARCHAR(30) NOT NULL CHECK (scenario IN ('pass','block','missing_evidence','error')),
 requires_approval BOOLEAN NOT NULL,
 state VARCHAR(20) NOT NULL CHECK (state IN ('succeeded','failed')),
 decision VARCHAR(20) NOT NULL CHECK (decision IN ('pass','block','inconclusive')),
 result JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(organization_id, project_id, idempotency_key)
);
CREATE TABLE stack_reviews (
 id UUID PRIMARY KEY,
 run_id UUID NOT NULL REFERENCES stack_runs(id),
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved','rejected')),
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stack_reviews_latest ON stack_reviews(run_id, created_at DESC, id DESC);
CREATE TABLE stack_audit (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL,
 project_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 action VARCHAR(60) NOT NULL,
 resource_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stack_runs_scope ON stack_runs(organization_id, project_id, created_at DESC, id DESC);
