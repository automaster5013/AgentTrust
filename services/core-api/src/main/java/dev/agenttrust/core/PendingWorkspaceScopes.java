package dev.agenttrust.core;

import java.sql.Types;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Narrow, bounded discovery of namespaces with existing durable admissions. */
@Component
public class PendingWorkspaceScopes {
    static final int PAGE_LIMIT=8;
    public record Scope(UUID organizationId,UUID projectId){
        public Scope{Objects.requireNonNull(organizationId);Objects.requireNonNull(projectId);}
    }
    private final JdbcTemplate jdbc;
    public PendingWorkspaceScopes(JdbcTemplate jdbc){this.jdbc=jdbc;}
    List<Scope> after(Scope cursor){
        List<Scope> rows=jdbc.query(connection->{
            var statement=connection.prepareStatement("SELECT organization_id,project_id FROM public.stack_pending_workspaces(?::uuid,?::uuid)");
            statement.setQueryTimeout(2);
            statement.setObject(1,cursor==null?null:cursor.organizationId(),Types.OTHER);
            statement.setObject(2,cursor==null?null:cursor.projectId(),Types.OTHER);
            return statement;
        },(result,index)->new Scope(result.getObject(1,UUID.class),result.getObject(2,UUID.class)));
        if(rows.size()>PAGE_LIMIT)throw new IllegalStateException("Pending workspace page unavailable");
        Scope previous=cursor;
        for(var row:rows){
            if(previous!=null && compare(row,previous)<=0)throw new IllegalStateException("Pending workspace order unavailable");
            previous=row;
        }
        return List.copyOf(rows);
    }
    static int compare(Scope left,Scope right){
        // PostgreSQL UUID order is unsigned byte order, unlike UUID.compareTo.
        int organization=left.organizationId().toString().compareTo(right.organizationId().toString());
        return organization!=0?organization:left.projectId().toString().compareTo(right.projectId().toString());
    }
}
