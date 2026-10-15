"""Owned PostgreSQL controls for startup/readiness privilege drift; never source grants."""
import hashlib,pathlib,re

BASELINE_STARTUP_QUERY="SELECT current_user='agenttrust_stack_api' AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AND NOT has_database_privilege(current_user,current_database(),'CREATE') AND NOT has_schema_privilege(current_user,'public','CREATE') AND NOT EXISTS (SELECT 1 FROM pg_roles privileged WHERE privileged.rolname<>current_user AND (privileged.rolsuper OR privileged.rolbypassrls) AND pg_has_role(current_user,privileged.oid,'MEMBER')) FROM pg_roles WHERE rolname=current_user"
BASELINE_READINESS_QUERY="SELECT current_user='agenttrust_stack_api' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT pg_has_role(current_user,'agenttrust_stack','member') AND current_setting('agenttrust.organization_id')='11111111-1111-1111-1111-111111111111' AND current_setting('agenttrust.project_id')='22222222-2222-2222-2222-222222222222' FROM pg_roles WHERE rolname=current_user"

def restricted_role_query(root):
    text=(pathlib.Path(root)/'services/core-api/src/main/java/dev/agenttrust/core/DatabaseApiRoleCheck.java').read_text(encoding='utf-8')
    values=re.findall(r'static final String ROLE_PREDICATE = "([^"\r\n]+)";',text)
    assert len(values)==1 and len(values[0])<=4096 and ';' not in values[0]
    assert 'static final String ROLE_QUERY = "SELECT " + ROLE_PREDICATE + " FROM pg_catalog.pg_roles WHERE rolname=current_user";' in text
    assert 'SCOPED_ROLE_QUERY = "SELECT (" + ROLE_PREDICATE +' in text
    return 'SELECT '+values[0]+' FROM pg_catalog.pg_roles WHERE rolname=current_user'

def verify(sql,process,api_environment,root):
    query=restricted_role_query(root)
    def observe(shadow=False):
        prefix="BEGIN;SET LOCAL ROLE agenttrust_stack_api;" if shadow else "BEGIN READ ONLY;SET LOCAL ROLE agenttrust_stack_api;"
        if shadow:
            prefix+="CREATE TEMP TABLE pg_roles(rolname NAME,rolsuper BOOLEAN,rolbypassrls BOOLEAN,rolcreatedb BOOLEAN,rolcreaterole BOOLEAN,rolreplication BOOLEAN,oid OID) ON COMMIT DROP;INSERT INTO pg_roles SELECT current_user,false,false,false,false,false,oid FROM pg_catalog.pg_roles WHERE rolname=current_user;"
        frame=sql(prefix+"SELECT set_config('agenttrust.organization_id','11111111-1111-1111-1111-111111111111',true);SELECT set_config('agenttrust.project_id','22222222-2222-2222-2222-222222222222',true);"+BASELINE_STARTUP_QUERY+';'+BASELINE_READINESS_QUERY+';'+query+';SELECT count(*) FROM public.stack_pending_workspaces(NULL,NULL);ROLLBACK;').decode('utf-8').splitlines()
        values=[value=='t' for value in frame if value in ('t','f')];assert len(values)==3
        assert [value for value in frame if value.isdigit()]==['0']
        return values
    assert observe()==[True,True,True]
    cases=[
        ('database-create',"GRANT CREATE ON DATABASE agenttrust_stack TO agenttrust_stack_api;","REVOKE CREATE ON DATABASE agenttrust_stack FROM agenttrust_stack_api;",False),
        ('public-schema-create',"GRANT CREATE ON SCHEMA public TO agenttrust_stack_api;","REVOKE CREATE ON SCHEMA public FROM agenttrust_stack_api;",False),
        ('inherited-role-admin',"CREATE ROLE fixture_role_admin CREATEROLE;ALTER ROLE agenttrust_stack_api NOINHERIT;GRANT fixture_role_admin TO agenttrust_stack_api;","REVOKE fixture_role_admin FROM agenttrust_stack_api;DROP ROLE fixture_role_admin;ALTER ROLE agenttrust_stack_api INHERIT;",True),
        ('noninherited-table-owner',"CREATE ROLE fixture_table_owner;CREATE TABLE public.fixture_role_probe(id INTEGER);ALTER TABLE public.fixture_role_probe OWNER TO fixture_table_owner;ALTER ROLE agenttrust_stack_api NOINHERIT;GRANT fixture_table_owner TO agenttrust_stack_api;","REVOKE fixture_table_owner FROM agenttrust_stack_api;DROP TABLE public.fixture_role_probe;DROP ROLE fixture_table_owner;ALTER ROLE agenttrust_stack_api INHERIT;",True),
        ('predefined-server-program',"GRANT pg_execute_server_program TO agenttrust_stack_api;","REVOKE pg_execute_server_program FROM agenttrust_stack_api;",True),
        ('predefined-all-table-writes',"GRANT pg_write_all_data TO agenttrust_stack_api;","REVOKE pg_write_all_data FROM agenttrust_stack_api;",True),
        ('temporary-catalog-shadow',"ALTER ROLE agenttrust_stack_api BYPASSRLS;","ALTER ROLE agenttrust_stack_api NOBYPASSRLS;",True),
    ]
    results=[]
    for name,grant,restore,old_startup in cases:
        sql(grant);values=observe(name=='temporary-catalog-shadow');assert values==[old_startup,True,False]
        denial=process('drift-'+name,api_environment,['--check-database-role'],1)
        assert denial['rejected'] and denial['apiRolePolicyRefused']
        sql(restore);assert observe()==[True,True,True]
        assert process('restored-'+name,api_environment,['--check-database-role'],0)['restrictedApiRoleVerified']
        results.append({'case':name,'baselineStartupPredicateAccepted':old_startup,'baselineReadinessDatabasePredicateAccepted':True,'newSharedPredicateRejected':True,'actualCompiledApiProcessRejected':True,'specificRolePolicyRejectionVerified':True,'restoringRestrictedGrantsRecovered':True,'pendingMetadataReadStillAvailableDuringControl':True})
    return {'completed':True,'cases':results,'sourceSqlPredicateSha256':hashlib.sha256(query.encode()).hexdigest(),'baselineQueryRevision':'f903c9ace3d9705c3bce3c408441cef460869aba','sameStartupAndReadinessRolePredicate':True,'temporaryCatalogShadowRejected':True,'fixtureRoleGrantsRestored':True,'originalSourceGrantsModified':False,'liveHttpReadinessPrivilegeDriftInjected':False}
