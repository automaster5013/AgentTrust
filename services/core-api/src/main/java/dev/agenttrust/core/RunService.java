package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public class RunService {
    private final JdbcTemplate jdbc; private final TransactionTemplate tx; private final ObjectMapper mapper;private final PolicyClient policy;
    public RunService(JdbcTemplate jdbc, TransactionTemplate tx, ObjectMapper mapper,PolicyClient policy) {this.jdbc=jdbc;this.tx=tx;this.mapper=mapper;this.policy=policy;}
    public List<Map<String,Object>> list(DemoUser user) {
        return scoped(user,()->jdbc.queryForList("SELECT r.id, r.provider, r.scenario, r.requires_approval, COALESCE(c.state,r.state) AS state, COALESCE(c.decision,r.decision) AS decision, r.created_at FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.organization_id=? AND r.project_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 50",user.organizationId(),user.projectId()));
    }
    public Map<String,Object> get(DemoUser user, UUID id) {
        return scoped(user,()->getScoped(user,id));
    }
    private Map<String,Object> getScoped(DemoUser user, UUID id) {
        var rows=jdbc.queryForList("SELECT r.id,r.organization_id,r.project_id,r.provider,r.scenario,r.requires_approval,COALESCE(c.state,r.state) AS state,COALESCE(c.decision,r.decision) AS decision,COALESCE(c.result,r.result)::text AS result,r.created_at,c.completed_at FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.id=? AND r.organization_id=? AND r.project_id=?",id,user.organizationId(),user.projectId());
        if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var row=rows.getFirst();try{row.put("result",mapper.readTree((String)row.get("result")));}catch(Exception error){throw new IllegalStateException("Stored result could not be read");}
        return row;
    }
    public Map<String,Object> create(DemoUser user,String key,String scenario,boolean approval) {
        return create(user,key,scenario,approval,"synthetic");
    }
    public Map<String,Object> create(DemoUser user,String key,String scenario,boolean approval,String provider) {
        requireWriter(user);
        if(!List.of("synthetic","ollama","openai","openai-compatible").contains(provider))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        String fingerprint;
        try{fingerprint=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((scenario+"\n"+approval+(provider.equals("synthetic")?"":"\nprovider/v1/"+provider)).getBytes(StandardCharsets.UTF_8)));}catch(Exception error){throw new IllegalStateException("Hash unavailable");}
        String hash=fingerprint;
        return scoped(user,() -> {
            // Serialize idempotency within the recorded tenant/project/key; hash collisions only serialize unrelated work.
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,user.organizationId()+"/"+user.projectId()+"/"+key);
            var existing=jdbc.queryForList("SELECT id,request_hash FROM stack_runs WHERE organization_id=? AND project_id=? AND idempotency_key=?",user.organizationId(),user.projectId(),key);
            if(!existing.isEmpty()) {if(!hash.equals(existing.getFirst().get("request_hash")))throw new ResponseStatusException(HttpStatus.CONFLICT);return get(user,(UUID)existing.getFirst().get("id"));}
            UUID id=UUID.randomUUID();var result=new Evaluation.Result("queued","inconclusive",List.of(new Evaluation.Rule("worker-completion",true,"inconclusive","Durable evaluation is awaiting Python worker completion.")),"python-queued");String json;
            try{json=mapper.writeValueAsString(result);}catch(Exception error){throw new IllegalStateException("Result unavailable");}
            jdbc.update("INSERT INTO stack_runs(id,organization_id,project_id,actor_id,idempotency_key,request_hash,scenario,requires_approval,state,decision,result,provider) VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb,?)",id,user.organizationId(),user.projectId(),user.actorId(),key,hash,scenario,approval,result.state(),result.decision(),json,provider);
            audit(user,"evaluation.queued",id);return get(user,id);
        });
    }
    List<Map<String,Object>> pending(DemoUser scope) {
        return scoped(scope,()->jdbc.queryForList("SELECT r.id,r.scenario,r.provider,(r.created_at < now()-interval '2 minutes') AS expired FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.organization_id=? AND r.project_id=? AND r.state='queued' AND c.run_id IS NULL ORDER BY r.created_at,r.id LIMIT 20",scope.organizationId(),scope.projectId()));
    }
    public record CampaignBinding(UUID campaignId,String caseId,UUID agentVersionId,UUID datasetVersionId,String executionProfileSha256) {public CampaignBinding(UUID c,String i,UUID a,UUID d){this(c,i,a,d,null);}}
    private List<Map<String,Object>> bindings(UUID id) {
        return jdbc.queryForList("SELECT c.campaign_id,c.case_id,p.agent_version_id,p.dataset_version_id,a.content_json,a.content_sha256 FROM stack_campaign_cases c JOIN stack_campaigns p ON p.id=c.campaign_id JOIN stack_agent_versions a ON a.id=p.agent_version_id WHERE c.run_id=?",id);
    }
    private void bindingScoped(UUID id,CampaignBinding supplied) {
        var rows=bindings(id);
        if(rows.isEmpty()){if(supplied!=null)throw new ResponseStatusException(HttpStatus.CONFLICT);return;}
        var row=rows.getFirst();
        if(supplied==null||!row.get("campaign_id").equals(supplied.campaignId())||!row.get("case_id").equals(supplied.caseId())||!row.get("agent_version_id").equals(supplied.agentVersionId())||!row.get("dataset_version_id").equals(supplied.datasetVersionId())||!java.util.Objects.equals(ExecutionProfiles.binding(mapper,(String)row.get("content_json"),(String)row.get("content_sha256")),supplied.executionProfileSha256()))throw new ResponseStatusException(HttpStatus.CONFLICT);
    }
    void validateBinding(DemoUser scope,UUID id,CampaignBinding supplied){scoped(scope,()->{bindingScoped(id,supplied);return null;});}
    Map<String,Object> job(DemoUser scope,Map<String,Object> run){return scoped(scope,()->{
        UUID id=(UUID)run.get("id");var body=new java.util.HashMap<String,Object>();body.put("runId",id.toString());body.put("organizationId",scope.organizationId().toString());body.put("projectId",scope.projectId().toString());body.put("scenario",run.get("scenario"));body.put("provider",run.get("provider"));var rows=bindings(id);
        if(!rows.isEmpty()){var row=rows.getFirst();body.put("campaignId",row.get("campaign_id").toString());body.put("caseId",row.get("case_id"));body.put("agentVersionId",row.get("agent_version_id").toString());body.put("datasetVersionId",row.get("dataset_version_id").toString());String profile=ExecutionProfiles.binding(mapper,(String)row.get("content_json"),(String)row.get("content_sha256"));if(profile!=null)body.put("executionProfileSha256",profile);}return Map.copyOf(body);
    });}
    public Map<String,Object> complete(DemoUser scope,UUID id,String scenario,Evaluation.Result result) {
        return complete(scope,id,scenario,result,null);
    }
    public Map<String,Object> complete(DemoUser scope,UUID id,String scenario,Evaluation.Result result,CampaignBinding supplied) {
        if(!"python-unavailable".equals(result.executionEngine()))WorkerClient.validated(result);
        return scoped(scope,()->{
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"completion/"+id);
            var admission=jdbc.queryForList("SELECT scenario,state,actor_id,provider,(created_at <= clock_timestamp()-interval '2 minutes') AS expired FROM stack_runs WHERE id=? AND organization_id=? AND project_id=?",id,scope.organizationId(),scope.projectId());
            if(admission.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            var original=admission.getFirst();if(!scenario.equals(original.get("scenario")) || !"queued".equals(original.get("state")))throw new ResponseStatusException(HttpStatus.CONFLICT);
            if(!"python-unavailable".equals(result.executionEngine()))bindingScoped(id,supplied);
            if(!"python-unavailable".equals(result.executionEngine())&&!WorkerClient.engine((String)original.get("provider")).equals(result.executionEngine()))throw new ResponseStatusException(HttpStatus.CONFLICT);
            if(!original.get("provider").equals("synthetic")&&result.state().equals("succeeded")&&jdbc.queryForObject("SELECT count(*) FROM stack_provider_attempts WHERE run_id=? AND provider=?",Long.class,id,original.get("provider"))!=1)throw new ResponseStatusException(HttpStatus.CONFLICT);
            var existing=jdbc.queryForList("SELECT run_id FROM stack_run_results WHERE run_id=?",id);
            if(!existing.isEmpty())return Map.of("accepted",true,"duplicate",true,"runId",id);
            // A delayed dispatcher must not leave a gap where a late success opens the gate.
            var effective=(Boolean)original.get("expired")?WorkerClient.unavailable():result;
            String json;try{json=mapper.writeValueAsString(effective);}catch(Exception error){throw new IllegalStateException("Completion unavailable");}
            jdbc.update("INSERT INTO stack_run_results(run_id,organization_id,project_id,state,decision,result) VALUES(?,?,?,?,?,?::jsonb)",id,scope.organizationId(),scope.projectId(),effective.state(),effective.decision(),json);
            var actor=new DemoUser("worker-result","unused",scope.organizationId(),scope.projectId(),(UUID)original.get("actor_id"),"viewer");audit(actor,"evaluation.completed",id);
            return Map.of("accepted",true,"duplicate",false,"runId",id);
        });
    }
    public List<Map<String,Object>> reviews(DemoUser user,UUID id) {
        return scoped(user,()->{get(user,id);return jdbc.queryForList("SELECT id,actor_id,decision,reason,created_at,review_sequence,policy_version,policy_digest FROM stack_reviews WHERE run_id=? AND organization_id=? AND project_id=? ORDER BY review_sequence DESC LIMIT 50",id,user.organizationId(),user.projectId());});
    }
    public Map<String,Object> review(DemoUser user,UUID id,String decision,String reason) {
        if(!user.role().equals("admin"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return scoped(user,() -> {
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"review/"+id);var run=get(user,id);
            if(!run.get("decision").equals("pass"))throw new ResponseStatusException(HttpStatus.CONFLICT);
            UUID review=UUID.randomUUID();jdbc.update("INSERT INTO stack_reviews(id,run_id,organization_id,project_id,actor_id,decision,reason,policy_version,policy_digest) VALUES(?,?,?,?,?,?,?,?,?)",review,id,user.organizationId(),user.projectId(),user.actorId(),decision,reason.strip(),policy.version(),policy.digest());
            audit(user,"review."+decision,id);return Map.of("id",review,"decision",decision);
        });
    }
    public Evaluation.Gate gate(DemoUser user,UUID id) {
        return scoped(user,() -> {
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"review/"+id);var run=get(user,id);
            var rows=reviews(user,id);
            return policy.decide(user,id,run,rows.isEmpty()?null:rows.getFirst());
        });
    }
    void audit(DemoUser user,String action,UUID id) {jdbc.update("INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id) VALUES(?,?,?,?,?,?)",UUID.randomUUID(),user.organizationId(),user.projectId(),user.actorId(),action,id);}
    <T> T scoped(DemoUser user,java.util.function.Supplier<T> action) {
        return tx.execute(status -> {jdbc.queryForObject("SELECT set_config('statement_timeout','3s',true)",String.class);jdbc.queryForObject("SELECT set_config('agenttrust.organization_id',?,true)",String.class,user.organizationId().toString());jdbc.queryForObject("SELECT set_config('agenttrust.project_id',?,true)",String.class,user.projectId().toString());return action.get();});
    }
    private static void requireWriter(DemoUser user) {if(!List.of("admin","editor").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);}
}
