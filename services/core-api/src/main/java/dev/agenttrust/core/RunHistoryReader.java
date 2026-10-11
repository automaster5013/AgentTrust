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
public class RunHistoryReader {
    private final RunService runs;private final JdbcTemplate jdbc;
    public RunHistoryReader(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
    public record Entry(UUID id,String provider,String scenario,boolean requiresApproval,String state,String decision,Instant createdAt){}
    public record Page(UUID organizationId,UUID projectId,List<Entry> entries,String nextCursor,int limit,String ordering,boolean deploymentAuthority){}
    public Page page(DemoUser user,String token){
        RunHistoryCursor cursor;try{cursor=token==null?null:RunHistoryCursor.decode(token,user);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
        return runs.scoped(user,()->{
            var params=new ArrayList<Object>();params.add(user.organizationId());params.add(user.projectId());String boundary="";
            if(cursor!=null){boundary=" AND (r.created_at,r.id)<(?,?)";params.add(Timestamp.from(cursor.createdAt()));params.add(cursor.id());}
            var rows=jdbc.query("SELECT r.id,r.provider,r.scenario,r.requires_approval,COALESCE(c.state,r.state) AS state,COALESCE(c.decision,r.decision) AS decision,r.created_at FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.organization_id=? AND r.project_id=?"+boundary+" ORDER BY r.created_at DESC,r.id DESC LIMIT 26",(row,index)->new Entry(row.getObject("id",UUID.class),row.getString("provider"),row.getString("scenario"),row.getBoolean("requires_approval"),row.getString("state"),row.getString("decision"),row.getTimestamp("created_at").toInstant()),params.toArray());
            var visible=List.copyOf(rows.subList(0,Math.min(25,rows.size())));String next=null;
            if(rows.size()>25){var last=visible.getLast();next=new RunHistoryCursor(user.organizationId(),user.projectId(),last.createdAt(),last.id()).encode();}
            return new Page(user.organizationId(),user.projectId(),visible,next,25,"created-at-id-desc",false);
        });
    }
}
