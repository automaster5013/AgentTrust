-- Critical operations recheck sessions after lock waits using the current clock.
CREATE OR REPLACE FUNCTION agenttrust.authenticate_session(hash text)
RETURNS TABLE(id uuid,organization_id uuid,name text,role text,organization_name text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT m.id,m.organization_id,m.name,m.role,o.name FROM agenttrust.sessions s
  JOIN agenttrust.credentials c ON c.id=s.credential_id JOIN agenttrust.memberships m ON m.id=c.membership_id
  JOIN agenttrust.organizations o ON o.id=m.organization_id
  WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp() AND c.revoked_at IS NULL AND m.active
$$;
