package dev.agenttrust.core;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuditReader {
    static final int LIMIT=25;
    private final RunService runs;private final JdbcTemplate jdbc;
    public AuditReader(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
    public record Entry(UUID id,UUID actorId,String action,UUID resourceId,Instant createdAt){}
    public record Page(UUID organizationId,UUID projectId,List<Entry> entries,String nextCursor,int limit,String ordering,boolean deploymentAuthority){}
    public Page page(DemoUser user,String token){
        AuditCursor cursor;
        try{cursor=token==null?null:AuditCursor.decode(token,user);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
        return runs.scoped(user,()->{
            var parameters=new ArrayList<Object>();parameters.add(user.organizationId());parameters.add(user.projectId());
            String boundary="";
            if(cursor!=null){boundary=" AND (created_at,id)<(?,?)";parameters.add(Timestamp.from(cursor.createdAt()));parameters.add(cursor.id());}
            var entries=jdbc.query("SELECT id,actor_id,action,resource_id,created_at FROM stack_audit WHERE organization_id=? AND project_id=?"+boundary+" ORDER BY created_at DESC,id DESC LIMIT 26",(row,index)->new Entry(row.getObject("id",UUID.class),row.getObject("actor_id",UUID.class),row.getString("action"),row.getObject("resource_id",UUID.class),row.getTimestamp("created_at").toInstant()),parameters.toArray());
            boolean more=entries.size()>LIMIT;var visible=List.copyOf(entries.subList(0,Math.min(LIMIT,entries.size())));String next=null;
            if(more){var last=visible.getLast();next=new AuditCursor(user.organizationId(),user.projectId(),last.createdAt(),last.id()).encode();}
            return new Page(user.organizationId(),user.projectId(),visible,next,LIMIT,"created-at-id-desc",false);
        });
    }
}
