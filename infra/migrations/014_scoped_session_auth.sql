-- Session lookup must be possible before tenant context without exposing raw tables.
GRANT SELECT ON agenttrust.organizations,agenttrust.credentials,agenttrust.sessions TO agenttrust_auth;
CREATE FUNCTION agenttrust.lookup_credential(hash text)
RETURNS TABLE(credential_id uuid,membership_id uuid,organization_id uuid,name text,role text,organization_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT c.id,m.id,m.organization_id,m.name,m.role,o.name FROM agenttrust.credentials c
  JOIN agenttrust.memberships m ON m.id=c.membership_id JOIN agenttrust.organizations o ON o.id=m.organization_id
  WHERE c.token_hash=$1 AND c.revoked_at IS NULL AND m.active
$$;
ALTER FUNCTION agenttrust.lookup_credential(text) OWNER TO agenttrust_auth;
REVOKE ALL ON FUNCTION agenttrust.lookup_credential(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agenttrust.lookup_credential(text) TO agenttrust_api;

CREATE FUNCTION agenttrust.authenticate_session(hash text)
RETURNS TABLE(id uuid,organization_id uuid,name text,role text,organization_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT m.id,m.organization_id,m.name,m.role,o.name FROM agenttrust.sessions s
  JOIN agenttrust.credentials c ON c.id=s.credential_id JOIN agenttrust.memberships m ON m.id=c.membership_id
  JOIN agenttrust.organizations o ON o.id=m.organization_id
  WHERE s.token_hash=$1 AND s.expires_at>now() AND c.revoked_at IS NULL AND m.active
$$;
ALTER FUNCTION agenttrust.authenticate_session(text) OWNER TO agenttrust_auth;
REVOKE ALL ON FUNCTION agenttrust.authenticate_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agenttrust.authenticate_session(text) TO agenttrust_api;

ALTER TABLE agenttrust.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_organizations ON agenttrust.organizations TO agenttrust_api
  USING(id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE agenttrust.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_memberships ON agenttrust.memberships TO agenttrust_api
  USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);
ALTER TABLE agenttrust.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_credentials ON agenttrust.credentials TO agenttrust_api
  USING(EXISTS(SELECT 1 FROM agenttrust.memberships m WHERE m.id=membership_id
    AND m.organization_id=nullif(current_setting('app.organization_id',true),'')::uuid));
ALTER TABLE agenttrust.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenttrust.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_sessions ON agenttrust.sessions TO agenttrust_api
  USING(EXISTS(SELECT 1 FROM agenttrust.credentials c JOIN agenttrust.memberships m ON m.id=c.membership_id
    WHERE c.id=credential_id AND m.organization_id=nullif(current_setting('app.organization_id',true),'')::uuid));
