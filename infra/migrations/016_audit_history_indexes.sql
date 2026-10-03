CREATE INDEX audit_history ON agenttrust.audit_events(organization_id,created_at DESC,id DESC);
CREATE INDEX audit_action_history ON agenttrust.audit_events(organization_id,action,created_at DESC,id DESC);
