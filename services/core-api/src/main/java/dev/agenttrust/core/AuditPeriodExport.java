package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;import java.nio.charset.StandardCharsets;import java.sql.Timestamp;import java.util.*;import org.springframework.http.HttpStatus;import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.stereotype.Service;import org.springframework.web.server.ResponseStatusException;

/** Bounded keyset chunks, each from one scoped SELECT; never a signed global snapshot. */
@Service
public class AuditPeriodExport {
 static final int LIMIT=250;
 private final RunService runs;private final JdbcTemplate jdbc;private final ObjectMapper mapper;
 public AuditPeriodExport(RunService runs,JdbcTemplate jdbc,ObjectMapper mapper){this.runs=runs;this.jdbc=jdbc;this.mapper=mapper;}
 static Map<String,Object> document(DemoUser user,AuditPeriod period,String requested,List<AuditReader.Entry> rows){
  AuditCursor boundary=requested==null?null:AuditPeriodCursor.decode(requested,user,period);if(rows.size()>LIMIT+1)throw new IllegalArgumentException("Export chunk limit");
  var entries=List.copyOf(rows.subList(0,Math.min(rows.size(),LIMIT)));AuditExport.document(user,entries);
  for(var row:entries){
   var at=new AuditCursor(user.organizationId(),user.projectId(),row.createdAt(),row.id());AuditPeriodCursor.decode(AuditPeriodCursor.encode(at,period),user,period);
   if(period.actorId()!=null&&!row.actorId().equals(period.actorId())||period.filters().action()!=null&&!row.action().equals(period.filters().action())||period.filters().resourceId()!=null&&!row.resourceId().equals(period.filters().resourceId()))throw new IllegalArgumentException("Export filter mismatch");
   if(boundary!=null&&(row.createdAt().isAfter(boundary.createdAt())||row.createdAt().equals(boundary.createdAt())&&row.id().toString().compareTo(boundary.id().toString())>=0))throw new IllegalArgumentException("Export boundary mismatch");
  }
  boolean more=rows.size()>LIMIT;var doc=new TreeMap<String,Object>();doc.put("schemaVersion",1);doc.put("kind","audit-period-export-chunk");doc.put("organizationId",user.organizationId());doc.put("projectId",user.projectId());doc.put("startDay",period.startDay().toString());doc.put("endDay",period.endDay().toString());doc.put("actorId",period.actorId());doc.put("filters",period.filters());doc.put("ordering","created-at-id-desc");doc.put("limit",LIMIT);doc.put("entries",entries);doc.put("recordCount",entries.size());doc.put("requestedCursor",requested);doc.put("isFirstChunk",requested==null);doc.put("hasOlderRecords",more);doc.put("rangeExhausted",!more);doc.put("entirePeriodHistory",requested==null&&!more);doc.put("entireProjectHistory",false);doc.put("singleStatementSnapshot",true);doc.put("currentDeploymentAuthority",false);doc.put("signed",false);
  String newest=entries.isEmpty()?null:token(user,period,entries.getFirst()),oldest=entries.isEmpty()?null:token(user,period,entries.getLast());doc.put("newestCursor",newest);doc.put("oldestCursor",oldest);doc.put("nextCursor",more?oldest:null);return doc;
 }
 private static String token(DemoUser user,AuditPeriod period,AuditReader.Entry entry){return AuditPeriodCursor.encode(new AuditCursor(user.organizationId(),user.projectId(),entry.createdAt(),entry.id()),period);}
 public Map<String,Object> export(DemoUser user,AuditPeriod period,String requested){
  AuditCursor boundary=requested==null?null:AuditPeriodCursor.decode(requested,user,period);
  return runs.scoped(user,()->{
   var parameters=new ArrayList<Object>();parameters.add(user.organizationId());parameters.add(user.projectId());String clause="";
   if(period.actorId()!=null){clause+=" AND actor_id=?";parameters.add(period.actorId());}
   if(period.filters().action()!=null){clause+=" AND action=?";parameters.add(period.filters().action());}
   if(period.filters().resourceId()!=null){clause+=" AND resource_id=?";parameters.add(period.filters().resourceId());}
   clause+=" AND created_at>=? AND created_at<?";parameters.add(Timestamp.from(period.startInclusive()));parameters.add(Timestamp.from(period.endExclusive()));
   if(boundary!=null){clause+=" AND (created_at,id)<(?,?)";parameters.add(Timestamp.from(boundary.createdAt()));parameters.add(boundary.id());}
   var rows=jdbc.query("SELECT id,actor_id,action,resource_id,created_at FROM stack_audit WHERE organization_id=? AND project_id=?"+clause+" ORDER BY created_at DESC,id DESC LIMIT 251",(row,index)->new AuditReader.Entry(row.getObject("id",UUID.class),row.getObject("actor_id",UUID.class),row.getString("action"),row.getObject("resource_id",UUID.class),row.getTimestamp("created_at").toInstant()),parameters.toArray());
   try{byte[] bytes=mapper.writeValueAsBytes(document(user,period,requested,rows));String digest=AuditExport.digest(bytes);return Map.of("contentJson",new String(bytes,StandardCharsets.UTF_8),"contentSha256",digest,"contentBytes",bytes.length,"organizationId",user.organizationId(),"projectId",user.projectId(),"signed",false,"currentDeploymentAuthority",false);}
   catch(Exception invalid){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);}
  });
 }
}
