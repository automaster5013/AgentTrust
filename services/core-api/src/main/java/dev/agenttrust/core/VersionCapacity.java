package dev.agenttrust.core;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.math.BigDecimal;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
/** Counts retained versions in one scoped SELECT; it does not reserve admission capacity. */
@Service
public class VersionCapacity {
 private final RunService runs;private final JdbcTemplate jdbc;
 public VersionCapacity(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
 public record Count(long used,int limit,long remaining,boolean exhausted){}
 public record Snapshot(String contract,String scope,UUID organizationId,UUID projectId,Instant observedAt,Count agents,Count datasets,boolean reservationGranted,boolean deploymentAuthority){}
 public Snapshot read(DemoUser user){
  if(user==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
  if(!List.of("admin","editor","viewer").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
  return runs.scoped(user,()->{
   var row=jdbc.queryForMap("SELECT (SELECT count(*) FROM stack_agent_versions WHERE organization_id=? AND project_id=?) AS agents, (SELECT count(*) FROM stack_dataset_versions WHERE organization_id=? AND project_id=?) AS datasets",user.organizationId(),user.projectId(),user.organizationId(),user.projectId());
   return new Snapshot("project-version-capacity-v1","project",user.organizationId(),user.projectId(),Instant.now(),count(row.get("agents")),count(row.get("datasets")),false,false);
  });
 }
 private static Count count(Object raw){
  if(!(raw instanceof Number number))throw new IllegalStateException("Version capacity unavailable");
  long used;try{used=new BigDecimal(number.toString()).longValueExact();}catch(ArithmeticException|NumberFormatException error){throw new IllegalStateException("Version capacity unavailable");}
  if(used<0||used>9_007_199_254_740_991L)throw new IllegalStateException("Version capacity unavailable");
  return new Count(used,VersionRegistry.RETAINED_LIMIT,Math.max(0L,VersionRegistry.RETAINED_LIMIT-used),used>=VersionRegistry.RETAINED_LIMIT);
 }
}
