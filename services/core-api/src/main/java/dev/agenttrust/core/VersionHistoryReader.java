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
public class VersionHistoryReader {
 private final RunService runs;private final JdbcTemplate jdbc;
 public VersionHistoryReader(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
 public record Entry(UUID id,String resourceKey,int version,String contentSha256,Instant createdAt){}
 public record Page(UUID organizationId,UUID projectId,String kind,List<Entry> entries,String nextCursor,int limit,String ordering,boolean deploymentAuthority){}
 public Page page(DemoUser user,String kind,String token){
  String table=switch(kind){case "agents"->"stack_agent_versions";case "datasets"->"stack_dataset_versions";default->throw new IllegalArgumentException("Invalid registry kind");};
  VersionHistoryCursor cursor;try{cursor=token==null?null:VersionHistoryCursor.decode(token,user,kind);}catch(IllegalArgumentException error){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
  return runs.scoped(user,()->{
   var params=new ArrayList<Object>();params.add(user.organizationId());params.add(user.projectId());String boundary="";
   if(cursor!=null){boundary=" AND (created_at,id)<(?,?)";params.add(Timestamp.from(cursor.createdAt()));params.add(cursor.id());}
   var rows=jdbc.query("SELECT id,resource_key,version,content_sha256,created_at FROM "+table+" WHERE organization_id=? AND project_id=?"+boundary+" ORDER BY created_at DESC,id DESC LIMIT 26",(row,index)->new Entry(row.getObject("id",UUID.class),row.getString("resource_key"),row.getInt("version"),row.getString("content_sha256"),row.getTimestamp("created_at").toInstant()),params.toArray());
   var visible=List.copyOf(rows.subList(0,Math.min(25,rows.size())));String next=null;
   if(rows.size()>25){var last=visible.getLast();next=new VersionHistoryCursor(kind,user.organizationId(),user.projectId(),last.createdAt(),last.id()).encode();}
   return new Page(user.organizationId(),user.projectId(),kind,visible,next,25,"created-at-id-desc",false);
  });
 }
}
