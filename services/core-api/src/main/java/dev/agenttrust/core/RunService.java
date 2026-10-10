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
    private final JdbcTemplate jdbc; private final TransactionTemplate tx; private final ObjectMapper mapper; private final WorkerClient worker;
    public RunService(JdbcTemplate jdbc, TransactionTemplate tx, ObjectMapper mapper, WorkerClient worker) {this.jdbc=jdbc;this.tx=tx;this.mapper=mapper;this.worker=worker;}
    public List<Map<String,Object>> list(DemoUser user) {
        return scoped(user,()->jdbc.queryForList("SELECT id, scenario, requires_approval, state, decision, created_at FROM stack_runs WHERE organization_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 50",user.organizationId(),user.projectId()));
    }
    public Map<String,Object> get(DemoUser user, UUID id) {
        return scoped(user,()->getScoped(user,id));
    }
    private Map<String,Object> getScoped(DemoUser user, UUID id) {
        var rows=jdbc.queryForList("SELECT id,organization_id,project_id,scenario,requires_approval,state,decision,result::text,created_at FROM stack_runs WHERE id=? AND organization_id=? AND project_id=?",id,user.organizationId(),user.projectId());
        if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var row=rows.getFirst();try{row.put("result",mapper.readTree((String)row.get("result")));}catch(Exception error){throw new IllegalStateException("Stored result could not be read");}
        return row;
    }
    public Map<String,Object> create(DemoUser user,String key,String scenario,boolean approval) {
        requireWriter(user);
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        String fingerprint;
        try{fingerprint=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((scenario+"\n"+approval).getBytes(StandardCharsets.UTF_8)));}catch(Exception error){throw new IllegalStateException("Hash unavailable");}
        String hash=fingerprint;
        return scoped(user,() -> {
            // Serialize idempotency within the recorded tenant/project/key; hash collisions only serialize unrelated work.
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,user.organizationId()+"/"+user.projectId()+"/"+key);
            var existing=jdbc.queryForList("SELECT id,request_hash FROM stack_runs WHERE organization_id=? AND project_id=? AND idempotency_key=?",user.organizationId(),user.projectId(),key);
            if(!existing.isEmpty()) {if(!hash.equals(existing.getFirst().get("request_hash")))throw new ResponseStatusException(HttpStatus.CONFLICT);return get(user,(UUID)existing.getFirst().get("id"));}
            UUID id=UUID.randomUUID();var result=worker.evaluate(user,id,scenario);String json;
            try{json=mapper.writeValueAsString(result);}catch(Exception error){throw new IllegalStateException("Result unavailable");}
            jdbc.update("INSERT INTO stack_runs(id,organization_id,project_id,actor_id,idempotency_key,request_hash,scenario,requires_approval,state,decision,result) VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb)",id,user.organizationId(),user.projectId(),user.actorId(),key,hash,scenario,approval,result.state(),result.decision(),json);
            audit(user,"evaluation.completed",id);return get(user,id);
        });
    }
    public List<Map<String,Object>> reviews(DemoUser user,UUID id) {
        return scoped(user,()->{get(user,id);return jdbc.queryForList("SELECT id,actor_id,decision,reason,created_at,review_sequence FROM stack_reviews WHERE run_id=? AND organization_id=? AND project_id=? ORDER BY review_sequence DESC LIMIT 50",id,user.organizationId(),user.projectId());});
    }
    public Map<String,Object> review(DemoUser user,UUID id,String decision,String reason) {
        if(!user.role().equals("admin"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        return scoped(user,() -> {
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"review/"+id);var run=get(user,id);
            if(!run.get("decision").equals("pass"))throw new ResponseStatusException(HttpStatus.CONFLICT);
            UUID review=UUID.randomUUID();jdbc.update("INSERT INTO stack_reviews(id,run_id,organization_id,project_id,actor_id,decision,reason) VALUES(?,?,?,?,?,?,?)",review,id,user.organizationId(),user.projectId(),user.actorId(),decision,reason.strip());
            audit(user,"review."+decision,id);return Map.of("id",review,"decision",decision);
        });
    }
    public Evaluation.Gate gate(DemoUser user,UUID id) {
        return scoped(user,() -> {
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"review/"+id);var run=get(user,id);
            var rows=reviews(user,id);String latest=rows.isEmpty()?null:(String)rows.getFirst().get("decision");
            return Evaluation.gate((String)run.get("decision"),(Boolean)run.get("requires_approval"),latest);
        });
    }
    private void audit(DemoUser user,String action,UUID id) {jdbc.update("INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id) VALUES(?,?,?,?,?,?)",UUID.randomUUID(),user.organizationId(),user.projectId(),user.actorId(),action,id);}
    private <T> T scoped(DemoUser user,java.util.function.Supplier<T> action) {
        return tx.execute(status -> {jdbc.queryForObject("SELECT set_config('agenttrust.organization_id',?,true)",String.class,user.organizationId().toString());jdbc.queryForObject("SELECT set_config('agenttrust.project_id',?,true)",String.class,user.projectId().toString());return action.get();});
    }
    private static void requireWriter(DemoUser user) {if(!List.of("admin","editor").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);}
}
