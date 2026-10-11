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
public class CampaignHistoryReader {
    private final RunService runs;private final JdbcTemplate jdbc;
    public CampaignHistoryReader(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
    public record Entry(UUID id,UUID agentVersionId,UUID datasetVersionId,boolean requiresApproval,Instant createdAt){}
    public record Page(UUID organizationId,UUID projectId,UUID datasetVersionId,List<Entry> entries,String nextCursor,int limit,String ordering,boolean deploymentAuthority){}
    public Page page(DemoUser user,UUID dataset,String token){
        CampaignHistoryCursor cursor;try{cursor=token==null?null:CampaignHistoryCursor.decode(token,user,dataset);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
        return runs.scoped(user,()->{
            var params=new ArrayList<Object>();params.add(user.organizationId());params.add(user.projectId());String filter="",boundary="";
            if(dataset!=null){filter=" AND dataset_version_id=?";params.add(dataset);}
            if(cursor!=null){boundary=" AND (created_at,id)<(?,?)";params.add(Timestamp.from(cursor.createdAt()));params.add(cursor.id());}
            var rows=jdbc.query("SELECT id,agent_version_id,dataset_version_id,requires_approval,created_at FROM stack_campaigns WHERE organization_id=? AND project_id=?"+filter+boundary+" ORDER BY created_at DESC,id DESC LIMIT 26",(row,index)->new Entry(row.getObject("id",UUID.class),row.getObject("agent_version_id",UUID.class),row.getObject("dataset_version_id",UUID.class),row.getBoolean("requires_approval"),row.getTimestamp("created_at").toInstant()),params.toArray());
            var visible=List.copyOf(rows.subList(0,Math.min(25,rows.size())));String next=null;
            if(rows.size()>25){var last=visible.getLast();next=new CampaignHistoryCursor(user.organizationId(),user.projectId(),dataset,last.createdAt(),last.id()).encode();}
            return new Page(user.organizationId(),user.projectId(),dataset,visible,next,25,"created-at-id-desc",false);
        });
    }
}
