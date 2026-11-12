package dev.agenttrust.core;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.math.BigDecimal;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
/** Whole-project stored observations, without admission limits or release authority. */
@Service
public class EvaluationOverview {
 private final RunService runs;private final JdbcTemplate jdbc;
 public EvaluationOverview(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
 public record States(long queued,long succeeded,long failed){}
 public record Decisions(long pass,long block,long inconclusive){}
 public record Snapshot(String contract,String scope,UUID organizationId,UUID projectId,Instant observedAt,long retainedCount,States states,Decisions decisions,boolean deploymentAuthority){}
 public Snapshot read(DemoUser user){
  if(user==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
  if(!List.of("admin","editor","viewer").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
  return runs.scoped(user,()->{
   var row=jdbc.queryForMap("SELECT count(*) AS retained, count(*) FILTER (WHERE state='queued') AS queued, count(*) FILTER (WHERE state='succeeded') AS succeeded, count(*) FILTER (WHERE state='failed') AS failed, count(*) FILTER (WHERE decision='pass') AS pass, count(*) FILTER (WHERE decision='block') AS block, count(*) FILTER (WHERE decision='inconclusive') AS inconclusive, count(*) FILTER (WHERE state IN ('queued','failed') AND decision <> 'inconclusive') AS inconsistent FROM (SELECT COALESCE(c.state,r.state) AS state, COALESCE(c.decision,r.decision) AS decision FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.organization_id=? AND r.project_id=?) observations",user.organizationId(),user.projectId());
   long retained=count(row.get("retained")),queued=count(row.get("queued")),succeeded=count(row.get("succeeded")),failed=count(row.get("failed")),pass=count(row.get("pass")),block=count(row.get("block")),inconclusive=count(row.get("inconclusive"));
   if(retained!=queued+succeeded+failed||retained!=pass+block+inconclusive||queued+failed>inconclusive||count(row.get("inconsistent"))!=0)throw new IllegalStateException("Evaluation overview unavailable");
   return new Snapshot("project-evaluation-overview-v1","project",user.organizationId(),user.projectId(),Instant.now(),retained,new States(queued,succeeded,failed),new Decisions(pass,block,inconclusive),false);
  });
 }
 private static long count(Object raw){
  if(!(raw instanceof Number number))throw new IllegalStateException("Evaluation overview unavailable");
  long value;try{value=new BigDecimal(number.toString()).longValueExact();}catch(ArithmeticException|NumberFormatException error){throw new IllegalStateException("Evaluation overview unavailable");}
  if(value<0||value>9_007_199_254_740_991L)throw new IllegalStateException("Evaluation overview unavailable");return value;
 }
}
