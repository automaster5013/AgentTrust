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
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name="agenttrust.gate-signing-mode",havingValue="local-development")
public class ReceiptHistoryReader {
 private final RunService runs;private final JdbcTemplate jdbc;
 public ReceiptHistoryReader(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
 public record Entry(UUID id,UUID campaignId,String keyId,Instant createdAt){public Entry{if(id==null||campaignId==null||keyId==null||!keyId.matches("[a-f0-9]{64}")||createdAt==null)throw new IllegalStateException("Receipt metadata unavailable");}}
 public record Page(String contract,UUID organizationId,UUID projectId,UUID campaignId,List<Entry> entries,String nextCursor,int limit,String ordering,boolean signatureVerificationPerformed,boolean deploymentAuthority){}
 public Page page(DemoUser user,UUID campaign,String token){
  if(user==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
  if(!List.of("admin","editor","viewer").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
  ReceiptHistoryCursor cursor;try{cursor=token==null?null:ReceiptHistoryCursor.decode(token,user,campaign);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
  return runs.scoped(user,()->{
   var params=new ArrayList<Object>();params.add(user.organizationId());params.add(user.projectId());String filter="",boundary="";
   if(campaign!=null){filter=" AND campaign_id=?";params.add(campaign);}
   if(cursor!=null){boundary=" AND (created_at,id)<(?,?)";params.add(Timestamp.from(cursor.createdAt()));params.add(cursor.id());}
   var rows=jdbc.query("SELECT id,campaign_id,key_id,created_at FROM stack_campaign_receipts WHERE organization_id=? AND project_id=?"+filter+boundary+" ORDER BY created_at DESC,id DESC LIMIT 26",(row,index)->new Entry(row.getObject("id",UUID.class),row.getObject("campaign_id",UUID.class),row.getString("key_id"),row.getTimestamp("created_at").toInstant()),params.toArray());
   var visible=List.copyOf(rows.subList(0,Math.min(25,rows.size())));String next=null;
   if(rows.size()>25){var last=visible.getLast();next=new ReceiptHistoryCursor(user.organizationId(),user.projectId(),campaign,last.createdAt(),last.id()).encode();}
   return new Page("project-receipt-history-v1",user.organizationId(),user.projectId(),campaign,visible,next,25,"created-at-id-desc",false,false);
  });
 }
}
