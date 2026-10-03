CREATE FUNCTION agenttrust.protect_run_creation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state<>'queued' OR NEW.attempts<>0 OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL
    OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.outcome IS NOT NULL OR NEW.result_hash IS NOT NULL
  THEN RAISE EXCEPTION 'New runs must begin queued without completion evidence'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_run_creation BEFORE INSERT ON agenttrust.runs
  FOR EACH ROW EXECUTE FUNCTION agenttrust.protect_run_creation();
