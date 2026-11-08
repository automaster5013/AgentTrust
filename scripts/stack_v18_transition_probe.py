"""V17 -> V18 and old restricted-role process compatibility on an owned synthetic DB.

This is not a full old API/browser rollback or operating recovery proof.
"""
import hashlib
import json
import re
import uuid

BASELINE_REFERENCE = 'ghcr.io/automaster5013/agenttrust-core-api@sha256:2100eb9b961af09a37810db1e93017cb4e4bd76606d8229acb1934dc7834fac2'
BASELINE_REVISION = '1c9374edc0cd6cbb03f164099ce6d74e0f5fd782'
MANAGEMENT = {'stack_project_settings', 'stack_access_keys', 'stack_access_key_revocations'}


def require(value):
    if not value:raise ValueError('V18_TRANSITION_PROBE_UNVERIFIED')

def snapshot(sql):
    tables = json.loads(sql("SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public' AND tablename<>'flyway_schema_history';").decode().strip())
    require(isinstance(tables, list) and 1 <= len(tables) <= 32)
    require(len(set(tables)) == len(tables))
    rows = {}
    for table in tables:
        require(re.fullmatch('[a-z][a-z0-9_]{0,62}', table))
        query = "BEGIN READ ONLY;SET LOCAL statement_timeout='2s';SELECT count(*)::text||'|'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') FROM public.\"" + table + '" t;ROLLBACK;'
        lines = sql(query).decode().splitlines()
        value = next(v for v in lines if re.fullmatch(r'[0-9]+\|[a-f0-9]{64}', v))
        count, digest = value.split('|'); require(int(count) <= 1000)
        rows[table] = {'rows': int(count), 'sha256': digest}
    return rows


def verify(sql, process, migration, api, baseline_image, *, capture=None):
    capture = capture or (lambda: snapshot(sql))
    first = process('v17-baseline-migrate', migration, ['--migrate-only'], 0, selected_image=baseline_image)
    require(first['migrationsExecuted'] == 17)
    require(sql('SELECT count(*) FROM flyway_schema_history WHERE success;').decode().strip() == '17')
    org, project, actor, audit, key = [str(uuid.uuid4()) for _ in range(5)]
    scope = "BEGIN;SET LOCAL ROLE agenttrust_stack_api;SET LOCAL agenttrust.organization_id='" + org + "';SET LOCAL agenttrust.project_id='" + project + "';"
    sql(scope + "INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id) VALUES ('" + audit + "','" + org + "','" + project + "','" + actor + "','fixture.v17.preserved','" + project + "');COMMIT;")
    before = capture(); require(len(before) == 17 and not MANAGEMENT.intersection(before))
    require(before['stack_audit']['rows'] >= 1)
    require(process('v17-restricted-api', api, ['--check-database-role'], 0, selected_image=baseline_image)['restrictedApiRoleVerified'])
    upgrade = process('v18-candidate-migrate', migration, ['--migrate-only'], 0)
    require(upgrade['migrationsExecuted'] == 1)
    require(sql('SELECT count(*) FROM flyway_schema_history WHERE success;').decode().strip() == '18')
    after = capture(); require(set(after) == set(before) | MANAGEMENT)
    require(all(after[name] == value for name, value in before.items()))
    require(process('v18-candidate-api', api, ['--check-database-role'], 0)['restrictedApiRoleVerified'])
    # Synthetic writes use the restricted scoped API DB role, not operating rows.
    sql(scope + "INSERT INTO stack_project_settings(organization_id,project_id,revision,actor_id,name,description) VALUES ('" + org + "','" + project + "',1,'" + actor + "','Synthetic V18','Transition fixture');INSERT INTO stack_access_keys(id,organization_id,project_id,actor_id,name,secret_hash,expires_at) VALUES ('" + key + "','" + org + "','" + project + "','" + actor + "','Synthetic revoked key','" + hashlib.sha256(uuid.uuid4().bytes).hexdigest() + "',now()+interval '1 day');INSERT INTO stack_access_key_revocations(key_id,organization_id,project_id,actor_id) VALUES ('" + key + "','" + org + "','" + project + "','" + actor + "');COMMIT;")
    retained = capture()
    require(all(retained[name] == value for name, value in before.items()))
    require(all(retained[name]['rows'] == 1 for name in MANAGEMENT))
    # Return to the old API's role-check process only. Never run an old migrator
    # over the newer schema or delete new management/credential revocation rows.
    require(process('v18-old-api-return', api, ['--check-database-role'], 0, selected_image=baseline_image)['restrictedApiRoleVerified'])
    require(capture() == retained)
    require(process('v18-forward-repeat', migration, ['--migrate-only'], 0)['migrationsExecuted'] == 0)
    require(process('v18-forward-api', api, ['--check-database-role'], 0)['restrictedApiRoleVerified'])
    require(capture() == retained)
    return {'completed': True, 'baselineMigrations': 17, 'newMigrationsApplied': 1,
            'existingTablesPreserved': len(before), 'managementTablesRetained': 3,
            'oldRestrictedRoleProcessCompatible': True, 'forwardRepeatApplied': 0,
            'oldMigratorRunAfterUpgrade': False, 'oldFullApiBusinessFlowVerified': False,
            'operatingRecoveryVerified': False, 'actualDeploymentPerformed': False,
            'automaticDeploymentAllowed': False, 'healthyRollbackGuaranteed': False}
