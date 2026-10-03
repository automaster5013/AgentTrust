-- Preserve fail-closed DB gate rules for policies requiring administrator review.
CREATE OR REPLACE FUNCTION agenttrust.protect_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.state NOT IN ('queued','running') THEN RAISE EXCEPTION 'Terminal runs are immutable'; END IF;
    IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.agent_version_id,NEW.dataset_version_id,NEW.policy_version_id,
        NEW.idempotency_key,NEW.fingerprint,NEW.snapshot,NEW.snapshot_hash,NEW.timeout_ms,NEW.case_budget,NEW.max_attempts,NEW.deadline,NEW.created_at)
      IS DISTINCT FROM
       (OLD.id,OLD.organization_id,OLD.project_id,OLD.agent_version_id,OLD.dataset_version_id,OLD.policy_version_id,
        OLD.idempotency_key,OLD.fingerprint,OLD.snapshot,OLD.snapshot_hash,OLD.timeout_ms,OLD.case_budget,OLD.max_attempts,OLD.deadline,OLD.created_at)
    THEN RAISE EXCEPTION 'Run snapshot and configuration are immutable'; END IF;
    IF NEW.state='queued' AND OLD.state='running' THEN RAISE EXCEPTION 'Invalid state transition'; END IF;
    IF NEW.attempts<OLD.attempts OR NEW.attempts>NEW.max_attempts THEN RAISE EXCEPTION 'Invalid attempt count'; END IF;
  ELSE
    IF NEW.state<>'queued' OR NEW.outcome IS NOT NULL OR NEW.attempts<>0 THEN RAISE EXCEPTION 'New runs must be queued'; END IF;
    IF NOT EXISTS(SELECT 1 FROM agenttrust.versions WHERE id=NEW.agent_version_id AND kind='agent')
      OR NOT EXISTS(SELECT 1 FROM agenttrust.versions WHERE id=NEW.dataset_version_id AND kind='dataset')
      OR NOT EXISTS(SELECT 1 FROM agenttrust.versions WHERE id=NEW.policy_version_id AND kind='policy')
    THEN RAISE EXCEPTION 'Invalid version kind'; END IF;
  END IF;
  IF NEW.state NOT IN ('queued','running') THEN
    IF NEW.outcome IS NULL OR NEW.completed_at IS NULL OR NEW.result_hash IS NULL OR NEW.outcome->>'state' IS DISTINCT FROM NEW.state
    THEN RAISE EXCEPTION 'Terminal result evidence required'; END IF;
    IF NEW.outcome->'gate'->>'decision' NOT IN ('pass','block','inconclusive') OR NEW.outcome->'gate'->>'decision' IS NULL
    THEN RAISE EXCEPTION 'Gate decision required'; END IF;
    IF NEW.outcome->'gate'->>'deploymentAllowed' IS DISTINCT FROM (CASE WHEN NEW.state='succeeded' AND NEW.outcome->'gate'->>'decision'='pass' AND coalesce(NEW.snapshot->'policy'->>'requiresManualApproval','false')<>'true' THEN 'true' ELSE 'false' END)
    THEN RAISE EXCEPTION 'Invalid deployment permission'; END IF;
    IF NEW.snapshot->'policy'->>'requiresManualApproval'='true' AND NEW.state='succeeded' AND NEW.outcome->'gate'->>'decision'='pass'
      AND (NEW.outcome->'gate'->>'evaluationPassed' IS DISTINCT FROM 'true' OR NEW.outcome->'gate'->>'requiresManualApproval' IS DISTINCT FROM 'true')
    THEN RAISE EXCEPTION 'Manual approval gate evidence required'; END IF;
    IF NEW.state IN ('cancelled','timed_out') AND NEW.outcome->'gate'->>'decision'<>'inconclusive'
    THEN RAISE EXCEPTION 'Incomplete runs cannot pass'; END IF;
  END IF;
  RETURN NEW;
END $$;
