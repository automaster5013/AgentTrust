"""Narrow metadata capability checks, only on an owned disposable PostgreSQL fixture."""
import uuid


def verify(sql):
    organizations = ['7fffffff-ffff-ffff-ffff-ffffffffffff', '80000000-0000-0000-0000-000000000000']
    scopes = [(organization, str(uuid.UUID(int=index + 1))) for organization in organizations for index in range(5)]
    runs = [str(uuid.uuid4()) for _ in scopes]
    actor = str(uuid.uuid4())

    def api(statement, scope=None, write=False):
        prefix = "BEGIN;SET LOCAL ROLE agenttrust_stack_api;SET LOCAL statement_timeout='2s';"
        if scope:
            prefix += "SET LOCAL agenttrust.organization_id='" + scope[0] + "';SET LOCAL agenttrust.project_id='" + scope[1] + "';"
        return sql(prefix + statement + ';' + ('COMMIT;' if write else 'ROLLBACK;')).decode().splitlines()

    for index, scope in enumerate(scopes):
        api("INSERT INTO public.stack_runs(id,organization_id,project_id,actor_id,idempotency_key,request_hash,scenario,requires_approval,state,decision,result,provider) VALUES ('"
            + runs[index] + "','" + scope[0] + "','" + scope[1] + "','" + actor + "','owned-discovery-" + str(index)
            + "','" + '0' * 64 + "','pass',false,'queued','inconclusive','{}'::jsonb,'synthetic')", scope, True)
    assert api('SELECT count(*) FROM public.stack_runs', scopes[0])[-2] == '1'

    def page(cursor=None):
        args = "NULL::uuid,NULL::uuid" if cursor is None else "'" + cursor[0] + "'::uuid,'" + cursor[1] + "'::uuid"
        rows = api('SELECT organization_id::text||\'|\'||project_id::text FROM public.stack_pending_workspaces(' + args + ')')
        return [tuple(row.split('|')) for row in rows if '|' in row]

    first = page()
    second = page(first[-1])
    assert len(first) == 8 and len(second) == 2 and first + second == scopes
    assert page(second[-1]) == []
    assert api("SELECT count(*) FROM public.stack_pending_workspaces('" + scopes[0][0] + "'::uuid,NULL::uuid)")[-2] == '0'
    assert api('SELECT count(*) FROM public.stack_pending_workspaces(NULL::uuid,NULL::uuid);SELECT count(*) FROM public.stack_runs', scopes[0])[-2] == '1'
    api("INSERT INTO public.stack_run_results(run_id,organization_id,project_id,state,decision,result) VALUES ('"
        + runs[0] + "','" + scopes[0][0] + "','" + scopes[0][1] + "','succeeded','pass','{}'::jsonb)", scopes[0], True)
    assert page() == scopes[1:9]
    assert api('SELECT count(*) FROM public.stack_runs', scopes[0])[-2] == '1'
    assert api('SELECT count(*) FROM public.stack_run_results', scopes[1])[-2] == '0'
    assert api("SET LOCAL search_path=pg_temp,public;CREATE TEMP TABLE stack_runs(id UUID,organization_id UUID,project_id UUID,state TEXT);SELECT count(*) FROM public.stack_pending_workspaces(NULL::uuid,NULL::uuid)")[-2] == '8'
    capability = "SELECT (p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=off']::text[] AND pg_get_userbyid(p.proowner)='agenttrust_stack' AND has_function_privilege('agenttrust_stack_api',p.oid,'EXECUTE') AND NOT has_function_privilege('pg_read_all_data',p.oid,'EXECUTE') AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p WHERE p.oid='public.stack_pending_workspaces(uuid,uuid)'::regprocedure"
    assert sql(capability).decode().strip() == 't'
    api("DO $$BEGIN BEGIN ALTER FUNCTION public.stack_pending_workspaces(uuid,uuid) SECURITY INVOKER; RAISE EXCEPTION 'unsafe capability ownership'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END$$", write=True)
    assert sql(capability).decode().strip() == 't'
    return {'completed': True, 'fixtureScopes': 10, 'firstPage': 8, 'secondPage': 2,
            'postgresUnsignedUuidBoundaryVerified': True, 'completedRunsExcluded': True,
            'directBusinessTableRlsStillScoped': True, 'publicExecuteRevoked': True,
            'fixedSearchPathAndOwnerVerified': True, 'temporaryShadowTableCannotSubstituteMetadata': True, 'apiCannotAlterCapability': True,
            'sourceBusinessRowsModified': False}
