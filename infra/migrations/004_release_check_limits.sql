ALTER TABLE agenttrust.release_receipts
  ADD COLUMN principal_key text,
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash text,
  ADD CONSTRAINT release_check_key CHECK(idempotency_key IS NULL OR idempotency_key ~ '^[a-zA-Z0-9_-]{8,100}$'),
  ADD CONSTRAINT release_check_principal CHECK(idempotency_key IS NULL OR principal_key IS NOT NULL),
  ADD CONSTRAINT release_request_hash CHECK(request_hash IS NULL OR request_hash ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX release_check_idempotency ON agenttrust.release_receipts(organization_id,project_id,principal_key,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX release_receipts_org_time ON agenttrust.release_receipts(organization_id,created_at DESC);
