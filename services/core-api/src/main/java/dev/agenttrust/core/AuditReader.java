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
    public record SearchPage(UUID organizationId,UUID projectId,List<Entry> entries,String nextCursor,int limit,String ordering,boolean deploymentAuthority,AuditFilters filters){}
    public Page page(DemoUser user,String token){
        AuditCursor cursor;
        try{cursor=token==null?null:AuditCursor.decode(token,user);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
        return query(user,cursor,null);
    }
    public SearchPage search(DemoUser user,AuditFilters filters,String token){
        AuditCursor cursor=token==null?null:AuditSearchCursor.decode(token,user,filters);
        Page page=query(user,cursor,filters);
        return new SearchPage(page.organizationId(),page.projectId(),page.entries(),page.nextCursor(),page.limit(),page.ordering(),false,filters);
    }
    private Page query(DemoUser user,AuditCursor cursor,AuditFilters filters){
        return runs.scoped(user,()->{
            var parameters=new ArrayList<Object>();parameters.add(user.organizationId());parameters.add(user.projectId());
            String boundary="";
            if(filters!=null&&filters.action()!=null){boundary+=" AND action=?";parameters.add(filters.action());}
            if(filters!=null&&filters.resourceId()!=null){boundary+=" AND resource_id=?";parameters.add(filters.resourceId());}
            if(cursor!=null){boundary+=" AND (created_at,id)<(?,?)";parameters.add(Timestamp.from(cursor.createdAt()));parameters.add(cursor.id());}
            var entries=jdbc.query("SELECT id,actor_id,action,resource_id,created_at FROM stack_audit WHERE organization_id=? AND project_id=?"+boundary+" ORDER BY created_at DESC,id DESC LIMIT 26",(row,index)->new Entry(row.getObject("id",UUID.class),row.getObject("actor_id",UUID.class),row.getString("action"),row.getObject("resource_id",UUID.class),row.getTimestamp("created_at").toInstant()),parameters.toArray());
            boolean more=entries.size()>LIMIT;var visible=List.copyOf(entries.subList(0,Math.min(LIMIT,entries.size())));String next=null;
            if(more){var last=visible.getLast();var lastBoundary=new AuditCursor(user.organizationId(),user.projectId(),last.createdAt(),last.id());next=filters==null?lastBoundary.encode():AuditSearchCursor.encode(lastBoundary,filters);}
            return new Page(user.organizationId(),user.projectId(),visible,next,LIMIT,"created-at-id-desc",false);
        });
    }
}
