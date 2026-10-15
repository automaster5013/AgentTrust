package dev.agenttrust.core;

import java.sql.DriverManager;

final class DatabaseApiRoleCheck {
    private DatabaseApiRoleCheck(){}
    static void verify(DatabaseProcessBoundary.ConnectionSettings settings)throws Exception{
        try(var connection=DriverManager.getConnection(settings.url(),settings.username(),settings.password())){
            connection.setReadOnly(true);
            try(var statement=connection.prepareStatement("SELECT current_user='agenttrust_stack_api' AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AND NOT has_database_privilege(current_user,current_database(),'CREATE') AND NOT has_schema_privilege(current_user,'public','CREATE') AND NOT EXISTS (SELECT 1 FROM pg_roles privileged WHERE privileged.rolname<>current_user AND (privileged.rolsuper OR privileged.rolbypassrls) AND pg_has_role(current_user,privileged.oid,'MEMBER')) FROM pg_roles WHERE rolname=current_user")){
                statement.setQueryTimeout(5);
                try(var result=statement.executeQuery()){
                    if(!result.next()||!result.getBoolean(1)||result.next())throw new IllegalStateException("Restricted API database role unavailable");
                }
            }
        }
    }
}
