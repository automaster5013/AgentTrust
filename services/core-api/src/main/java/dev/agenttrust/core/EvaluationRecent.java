package dev.agenttrust.core;
import java.time.*;
import java.sql.Timestamp;
import java.util.*;
import java.math.BigDecimal;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
/** Completion-time observations in one database-anchored 24 hour window. */
@Service
public class EvaluationRecent {
 private final RunService runs; private final JdbcTemplate jdbc;
 public EvaluationRecent(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
 public record Snapshot(String contract,String scope,UUID organizationId,UUID projectId,Instant windowStart,Instant observedAt,long completedCount,long executionErrorCount,long unknownCompletionTimeCount,boolean deploymentAuthority){}
 static final String SQL="""
 WITH observations AS (
 SELECT r.created_at,COALESCE(c.state,r.state) AS state,COALESCE(c.decision,r.decision) AS decision,c.completed_at
 FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id
 WHERE r.organization_id=? AND r.project_id=?
 ), clock AS (SELECT statement_timestamp() AS observed_at)
 SELECT clock.observed_at,clock.observed_at-INTERVAL '24 hours' AS window_start,counts.*
 FROM clock CROSS JOIN LATERAL (
 SELECT count(*) FILTER (WHERE state IN ('succeeded','failed') AND completed_at BETWEEN clock.observed_at-INTERVAL '24 hours' AND clock.observed_at) AS completed,
 count(*) FILTER (WHERE state='failed' AND completed_at BETWEEN clock.observed_at-INTERVAL '24 hours' AND clock.observed_at) AS errors,
 count(*) FILTER (WHERE state IN ('succeeded','failed') AND completed_at IS NULL) AS unknown,
 count(*) FILTER (WHERE state IN ('succeeded','failed')) AS terminal,
 count(*) FILTER (WHERE state IS NULL OR state NOT IN ('queued','succeeded','failed') OR decision IS NULL OR decision NOT IN ('pass','block','inconclusive') OR (state IN ('queued','failed') AND decision<>'inconclusive') OR (state='queued' AND completed_at IS NOT NULL) OR completed_at>clock.observed_at OR completed_at<created_at) AS invalid
 FROM observations
 ) counts
 """;
 public Snapshot read(DemoUser user){
  if(user==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
  if(!List.of("admin","editor","viewer").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
  return runs.scoped(user,()->{
   var row=jdbc.queryForMap(SQL,user.organizationId(),user.projectId());
   long completed=count(row.get("completed")),errors=count(row.get("errors")),unknown=count(row.get("unknown")),terminal=count(row.get("terminal"));
   Instant start=time(row.get("window_start")),end=time(row.get("observed_at"));
   if(errors>completed||completed+unknown>terminal||count(row.get("invalid"))!=0||!start.plusSeconds(86400).equals(end))throw unavailable();
   return new Snapshot("project-evaluation-recent-v1","project",user.organizationId(),user.projectId(),start,end,completed,errors,unknown,false);
  });
 }
 private static Instant time(Object raw){Instant value;if(raw instanceof Timestamp t)value=t.toInstant();else if(raw instanceof OffsetDateTime t)value=t.toInstant();else if(raw instanceof Instant t)value=t;else throw unavailable();if(value.getNano()%1000!=0)throw unavailable();return value;}
 private static long count(Object raw){if(!(raw instanceof Number n))throw unavailable();try{long v=new BigDecimal(n.toString()).longValueExact();if(v<0||v>9_007_199_254_740_991L)throw unavailable();return v;}catch(ArithmeticException|NumberFormatException e){throw unavailable();}}
 private static IllegalStateException unavailable(){return new IllegalStateException("Recent evaluation observations unavailable");}
}
