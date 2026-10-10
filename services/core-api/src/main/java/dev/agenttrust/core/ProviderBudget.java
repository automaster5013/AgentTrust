package dev.agenttrust.core;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Immutable single-use reservation; ambiguous execution is never automatically billed again. */
@Service
public class ProviderBudget {
 private final RunService runs;private final JdbcTemplate jdbc;
 public ProviderBudget(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
 Map<String,Object> reserve(DemoUser scope,UUID id,String scenario,String provider){
  return runs.scoped(scope,()->{
   jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"provider-budget/"+scope.organizationId()+"/"+scope.projectId());
   var admission=jdbc.queryForList("SELECT r.scenario,r.provider,r.state,(r.created_at < now()-interval '2 minutes') AS expired FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.id=? AND r.organization_id=? AND r.project_id=? AND c.run_id IS NULL",id,scope.organizationId(),scope.projectId());
   if(admission.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
   var row=admission.getFirst();if(!scenario.equals(row.get("scenario"))||!provider.equals(row.get("provider"))||provider.equals("synthetic")||!row.get("state").equals("queued"))throw new ResponseStatusException(HttpStatus.CONFLICT);
   if((Boolean)row.get("expired")||jdbc.queryForObject("SELECT count(*) FROM stack_provider_attempts WHERE run_id=?",Long.class,id)>0)return denied(id);
   long used=jdbc.queryForObject("SELECT count(*) FROM stack_provider_attempts WHERE organization_id=? AND project_id=? AND budget_day=(now() AT TIME ZONE 'UTC')::date",Long.class,scope.organizationId(),scope.projectId());
   if(used>=100)return denied(id);
   jdbc.update("INSERT INTO stack_provider_attempts(run_id,organization_id,project_id,provider) VALUES(?,?,?,?)",id,scope.organizationId(),scope.projectId(),provider);
   return Map.of("runId",id,"allowed",true,"reservedInputTokens",256,"reservedOutputTokens",128);
  });
 }
 private static Map<String,Object> denied(UUID id){return Map.of("runId",id,"allowed",false);}
}
