package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CampaignService {
    private final RunService runs;private final VersionRegistry versions;private final JdbcTemplate jdbc;private final ObjectMapper mapper;private final PolicyClient policy;
    public CampaignService(RunService runs,VersionRegistry versions,JdbcTemplate jdbc,ObjectMapper mapper,PolicyClient policy){this.runs=runs;this.versions=versions;this.jdbc=jdbc;this.mapper=mapper;this.policy=policy;}
    public List<Map<String,Object>> list(DemoUser user){return runs.scoped(user,()->jdbc.queryForList("SELECT id,agent_version_id,dataset_version_id,requires_approval,created_at FROM stack_campaigns WHERE organization_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 50",user.organizationId(),user.projectId()));}
    public Map<String,Object> create(DemoUser user,String key,UUID agentId,UUID datasetId,Boolean approval){
        if(!List.of("admin","editor").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}")||agentId==null||datasetId==null||approval==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        String hash=ArchiveIntegrity.sha256(("campaign/v1\n"+agentId+"\n"+datasetId+"\n"+approval).getBytes(StandardCharsets.UTF_8));
        return runs.scoped(user,()->{
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign/"+user.organizationId()+"/"+user.projectId());
            var existing=jdbc.queryForList("SELECT id,request_hash FROM stack_campaigns WHERE organization_id=? AND project_id=? AND idempotency_key=?",user.organizationId(),user.projectId(),key);
            if(!existing.isEmpty()){if(!hash.equals(existing.getFirst().get("request_hash")))throw new ResponseStatusException(HttpStatus.CONFLICT);return get(user,(UUID)existing.getFirst().get("id"));}
            if(jdbc.queryForObject("SELECT count(*) FROM stack_campaigns WHERE organization_id=? AND project_id=?",Integer.class,user.organizationId(),user.projectId())>=200)throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS);
            var agent=versions.get(user,"agents",agentId);var dataset=versions.get(user,"datasets",datasetId);
            JsonNode definition=(JsonNode)agent.get("definition"),data=(JsonNode)dataset.get("definition");
            if(!definition.path("contract").asText().equals(VersionDefinition.CONTRACT)||!data.path("contract").asText().equals(VersionDefinition.CONTRACT))throw new ResponseStatusException(HttpStatus.CONFLICT);
            String provider=definition.path("provider").asText();JsonNode cases=data.path("cases");
            // Keep real-provider batches bounded under the existing per-case reservation and deadline.
            if(!provider.equals("synthetic")&&cases.size()>2)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
            UUID id=UUID.randomUUID();jdbc.update("INSERT INTO stack_campaigns(id,organization_id,project_id,actor_id,idempotency_key,request_hash,agent_version_id,dataset_version_id,agent_content_sha256,dataset_content_sha256,requires_approval) VALUES(?,?,?,?,?,?,?,?,?,?,?)",id,user.organizationId(),user.projectId(),user.actorId(),key,hash,agentId,datasetId,agent.get("content_sha256"),dataset.get("content_sha256"),approval);
            for(int i=0;i<cases.size();i++){
                var c=cases.get(i);var run=runs.create(user,"campaign_"+id.toString().replace("-","")+"_"+i,c.path("scenario").asText(),approval,provider);
                jdbc.update("INSERT INTO stack_campaign_cases(campaign_id,organization_id,project_id,case_index,case_id,required,run_id) VALUES(?,?,?,?,?,?,?)",id,user.organizationId(),user.projectId(),i,c.path("id").asText(),c.path("required").asBoolean(),run.get("id"));
            }
            runs.audit(user,"campaign.queued",id);return get(user,id);
        });
    }
    private Map<String,Object> admission(DemoUser user,UUID id){
        var rows=jdbc.queryForList("SELECT id,organization_id,project_id,agent_version_id,dataset_version_id,agent_content_sha256,dataset_content_sha256,requires_approval,created_at FROM stack_campaigns WHERE id=? AND organization_id=? AND project_id=?",id,user.organizationId(),user.projectId());
        if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);return rows.getFirst();
    }
    List<CampaignAggregate.CaseEvidence> cases(DemoUser user,UUID id){
        var rows=jdbc.queryForList("SELECT b.case_id,b.required,b.run_id,r.scenario,r.provider,COALESCE(c.state,r.state) AS state,COALESCE(c.decision,r.decision) AS decision FROM stack_campaign_cases b JOIN stack_runs r ON r.id=b.run_id LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE b.campaign_id=? AND b.organization_id=? AND b.project_id=? ORDER BY b.case_index",id,user.organizationId(),user.projectId());
        var values=new ArrayList<CampaignAggregate.CaseEvidence>();for(var row:rows)values.add(new CampaignAggregate.CaseEvidence((String)row.get("case_id"),(Boolean)row.get("required"),(UUID)row.get("run_id"),(String)row.get("scenario"),(String)row.get("provider"),(String)row.get("state"),(String)row.get("decision")));return List.copyOf(values);
    }
    public Map<String,Object> get(DemoUser user,UUID id){return runs.scoped(user,()->{
        var row=admission(user,id);var agent=versions.get(user,"agents",(UUID)row.get("agent_version_id"));var dataset=versions.get(user,"datasets",(UUID)row.get("dataset_version_id"));
        if(!row.get("agent_content_sha256").equals(agent.get("content_sha256"))||!row.get("dataset_content_sha256").equals(dataset.get("content_sha256")))throw new IllegalStateException("Campaign binding unavailable");
        var evidence=cases(user,id);var declared=((JsonNode)dataset.get("definition")).path("cases");
        if(evidence.size()!=declared.size())throw new IllegalStateException("Campaign case evidence unavailable");
        for(int i=0;i<evidence.size();i++){var c=evidence.get(i);var original=declared.get(i);if(!c.caseId().equals(original.path("id").asText())||!c.scenario().equals(original.path("scenario").asText())||c.required()!=original.path("required").asBoolean()||!c.provider().equals(((JsonNode)agent.get("definition")).path("provider").asText()))throw new IllegalStateException("Campaign case binding unavailable");}
        var result=CampaignAggregate.result(evidence);row.put("agentVersion",agent);row.put("datasetVersion",dataset);row.put("cases",evidence);row.put("result",result);row.put("state",result.state());row.put("decision",result.decision());return row;
    });}
    private List<Map<String,Object>> reviews(DemoUser user,UUID id){return jdbc.queryForList("SELECT id,decision,reason,actor_id,review_sequence,policy_version,policy_digest,created_at FROM stack_campaign_reviews WHERE campaign_id=? AND organization_id=? AND project_id=? ORDER BY review_sequence DESC LIMIT 50",id,user.organizationId(),user.projectId());}
    Map<String,Object> latestReview(DemoUser user,UUID id){return runs.scoped(user,()->{admission(user,id);var values=reviews(user,id);return values.isEmpty()?null:values.getFirst();});}
    public Map<String,Object> review(DemoUser user,UUID id,String decision,String reason){
        if(!user.role().equals("admin"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if(decision==null||!List.of("approved","rejected").contains(decision)||reason==null||reason.isBlank()||reason.length()>500)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return runs.scoped(user,()->{jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign-review/"+id);var value=get(user,id);
            if(!value.get("decision").equals("pass"))throw new ResponseStatusException(HttpStatus.CONFLICT);
            UUID review=UUID.randomUUID();jdbc.update("INSERT INTO stack_campaign_reviews(id,campaign_id,organization_id,project_id,actor_id,decision,reason,policy_version,policy_digest) VALUES(?,?,?,?,?,?,?,?,?)",review,id,user.organizationId(),user.projectId(),user.actorId(),decision,reason.strip(),policy.version(),policy.digest());runs.audit(user,"campaign.review."+decision,id);return Map.of("id",review,"decision",decision);
        });
    }
    public Evaluation.Gate gate(DemoUser user,UUID id){return runs.scoped(user,()->{
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign-review/"+id);var value=get(user,id);value.put("result",mapper.valueToTree(value.get("result")));var reviews=reviews(user,id);return policy.decide(user,id,value,reviews.isEmpty()?null:reviews.getFirst());
    });}
    public Map<String,Object> compare(DemoUser user,UUID id,UUID baseline){return runs.scoped(user,()->{
        if(id.equals(baseline))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        var current=get(user,id);var previous=get(user,baseline);
        var currentAgent=(Map<?,?>)current.get("agentVersion");var previousAgent=(Map<?,?>)previous.get("agentVersion");
        if(!current.get("dataset_version_id").equals(previous.get("dataset_version_id"))||!current.get("dataset_content_sha256").equals(previous.get("dataset_content_sha256"))||!currentAgent.get("resource_key").equals(previousAgent.get("resource_key")))throw new ResponseStatusException(HttpStatus.CONFLICT);
        if(current.get("state").equals("queued")||previous.get("state").equals("queued"))throw new ResponseStatusException(HttpStatus.CONFLICT);
        var comparison=CampaignAggregate.compare(cases(user,baseline),cases(user,id));
        return Map.of("campaignId",id,"baselineCampaignId",baseline,"organizationId",user.organizationId(),"projectId",user.projectId(),"datasetVersionId",current.get("dataset_version_id"),"datasetContentSha256",current.get("dataset_content_sha256"),"comparison",comparison);
    });}
}
