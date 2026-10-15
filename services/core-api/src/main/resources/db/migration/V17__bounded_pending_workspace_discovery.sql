-- The dispatcher may discover only the namespace of already-admitted pending
-- work. It does not gain cross-tenant SELECT on runs, results or payloads.
CREATE FUNCTION public.stack_pending_workspaces(after_organization UUID, after_project UUID)
RETURNS TABLE(organization_id UUID, project_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
 SELECT DISTINCT r.organization_id, r.project_id
 FROM public.stack_runs r
 WHERE r.state='queued'
   AND NOT EXISTS (SELECT 1 FROM public.stack_run_results c WHERE c.run_id=r.id)
   AND ((after_organization IS NULL AND after_project IS NULL)
        OR (after_organization IS NOT NULL AND after_project IS NOT NULL
            AND (r.organization_id,r.project_id)>(after_organization,after_project)))
 ORDER BY r.organization_id,r.project_id
 LIMIT 8
$$;
REVOKE ALL ON FUNCTION public.stack_pending_workspaces(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stack_pending_workspaces(UUID,UUID) TO agenttrust_stack_api;
