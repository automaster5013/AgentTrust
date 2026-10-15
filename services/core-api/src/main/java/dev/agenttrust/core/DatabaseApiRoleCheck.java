package dev.agenttrust.core;

import java.sql.DriverManager;

final class DatabaseApiRoleCheck {
    static final String ROLE_PREDICATE = "current_user='agenttrust_stack_api' AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AND NOT pg_catalog.has_database_privilege(current_user,pg_catalog.current_database(),'CREATE') AND NOT pg_catalog.has_schema_privilege(current_user,'public','CREATE') AND NOT pg_catalog.pg_has_role(current_user,'agenttrust_stack','MEMBER') AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles privileged WHERE privileged.rolname<>current_user AND pg_catalog.pg_has_role(current_user,privileged.oid,'MEMBER')) AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class owned JOIN pg_catalog.pg_namespace space ON space.oid=owned.relnamespace WHERE space.nspname='public' AND pg_catalog.pg_has_role(current_user,owned.relowner,'MEMBER'))";
    static final String ROLE_QUERY = "SELECT " + ROLE_PREDICATE + " FROM pg_catalog.pg_roles WHERE rolname=current_user";
    static final String SCOPED_ROLE_QUERY = "SELECT (" + ROLE_PREDICATE + ") AND pg_catalog.current_setting('agenttrust.organization_id')=? AND pg_catalog.current_setting('agenttrust.project_id')=? FROM pg_catalog.pg_roles WHERE rolname=current_user";
    static final class RolePolicyRefused extends IllegalStateException {private static final long serialVersionUID=1L;}
    private DatabaseApiRoleCheck(){}
    static void verify(DatabaseProcessBoundary.ConnectionSettings settings)throws Exception{
        try(var connection=DriverManager.getConnection(settings.url(),settings.username(),settings.password())){
            connection.setReadOnly(true);
            try(var statement=connection.prepareStatement(ROLE_QUERY)){
                statement.setQueryTimeout(5);
                try(var result=statement.executeQuery()){
                    if(!result.next()||!result.getBoolean(1)||result.next())throw new RolePolicyRefused();
                }
            }
        }
    }
}
