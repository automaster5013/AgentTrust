ALTER TABLE agenttrust.sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE agenttrust.sessions ADD CONSTRAINT sessions_public_id_unique UNIQUE(id);
CREATE INDEX sessions_credential_history ON agenttrust.sessions(credential_id,created_at DESC,id DESC);
CREATE INDEX sessions_expiry ON agenttrust.sessions(expires_at);
CREATE INDEX credentials_membership_lookup ON agenttrust.credentials(membership_id);
CREATE INDEX memberships_organization_lookup ON agenttrust.memberships(organization_id,id);
