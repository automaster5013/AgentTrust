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
 public record SearchPage(UUID organizationId,UUID projectId,String kind,String resourceKey,List<Entry> entries,String nextCursor,int limit,String ordering,boolean deploymentAuthority){}
 public Page page(DemoUser user,String kind,String token){return read(user,kind,null,token);}
 public SearchPage search(DemoUser user,String kind,String resourceKey,String token){
  String key=VersionHistorySearchCursor.key(resourceKey);var page=read(user,kind,key,token);
  return new SearchPage(page.organizationId(),page.projectId(),page.kind(),key,page.entries(),page.nextCursor(),page.limit(),page.ordering(),false);
 }
 private Page read(DemoUser user,String kind,String resourceKey,String token){
  String table=switch(kind){case "agents"->"stack_agent_versions";case "datasets"->"stack_dataset_versions";default->throw new IllegalArgumentException("Invalid registry kind");};
  VersionHistoryCursor cursor;try{cursor=token==null?null:resourceKey==null?VersionHistoryCursor.decode(token,user,kind):VersionHistorySearchCursor.decode(token,user,kind,resourceKey);}catch(IllegalArgumentException error){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
  return runs.scoped(user,()->{
   var params=new ArrayList<Object>();params.add(user.organizationId());params.add(user.projectId());String boundary="";if(resourceKey!=null){boundary=" AND resource_key=?";params.add(resourceKey);}
   if(cursor!=null){boundary+=" AND (created_at,id)<(?,?)";params.add(Timestamp.from(cursor.createdAt()));params.add(cursor.id());}
   var rows=jdbc.query("SELECT id,resource_key,version,content_sha256,created_at FROM "+table+" WHERE organization_id=? AND project_id=?"+boundary+" ORDER BY created_at DESC,id DESC LIMIT 26",(row,index)->new Entry(row.getObject("id",UUID.class),row.getString("resource_key"),row.getInt("version"),row.getString("content_sha256"),row.getTimestamp("created_at").toInstant()),params.toArray());
   var visible=List.copyOf(rows.subList(0,Math.min(25,rows.size())));String next=null;
   if(rows.size()>25){var last=visible.getLast();var edge=new VersionHistoryCursor(kind,user.organizationId(),user.projectId(),last.createdAt(),last.id());next=resourceKey==null?edge.encode():VersionHistorySearchCursor.encode(edge,resourceKey);}
   return new Page(user.organizationId(),user.projectId(),kind,visible,next,25,"created-at-id-desc",false);
  });
 }
}
