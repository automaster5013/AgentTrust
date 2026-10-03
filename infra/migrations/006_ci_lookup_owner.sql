-- Authentication needs a bounded cross-tenant lookup, not superuser execution.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='agenttrust_auth') THEN
    CREATE ROLE agenttrust_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
  END IF;
END $$;
ALTER ROLE agenttrust_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
GRANT USAGE ON SCHEMA agenttrust TO agenttrust_auth;
GRANT SELECT ON agenttrust.ci_credentials,agenttrust.memberships TO agenttrust_auth;
ALTER FUNCTION agenttrust.authenticate_ci(text) OWNER TO agenttrust_auth;
REVOKE ALL ON FUNCTION agenttrust.authenticate_ci(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agenttrust.authenticate_ci(text) TO agenttrust_api;
