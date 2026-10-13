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
    private final RunService runs;private final VersionRegistry versions;private final JdbcTemplate jdbc;private final ObjectMapper mapper;private final PolicyClient policy;private final VersionLifecycle lifecycle;
    public CampaignService(RunService runs,VersionRegistry versions,JdbcTemplate jdbc,ObjectMapper mapper,PolicyClient policy,VersionLifecycle lifecycle){this.runs=runs;this.versions=versions;this.jdbc=jdbc;this.mapper=mapper;this.policy=policy;this.lifecycle=lifecycle;}
    public List<Map<String,Object>> list(DemoUser user){return runs.scoped(user,()->jdbc.queryForList("SELECT id,agent_version_id,dataset_version_id,requires_approval,created_at FROM stack_campaigns WHERE organization_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 50",user.organizationId(),user.projectId()));}
    public Map<String,Object> create(DemoUser user,String key,UUID agentId,UUID datasetId,Boolean approval){
        return create(user,key,agentId,datasetId,approval,null,null);
    }
    public Map<String,Object> create(DemoUser user,String key,UUID agentId,UUID datasetId,Boolean approval,UUID baselineId,Integer maxAge){
        if(!List.of("admin","editor").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}")||agentId==null||datasetId==null||approval==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        CampaignReleaseRequirements.parameters(baselineId,maxAge);
        String hash=CampaignReleaseRequirements.requestHash(agentId,datasetId,approval,baselineId,maxAge);
        return runs.scoped(user,()->{
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign/"+user.organizationId()+"/"+user.projectId());
            var existing=jdbc.queryForList("SELECT id,request_hash FROM stack_campaigns WHERE organization_id=? AND project_id=? AND idempotency_key=?",user.organizationId(),user.projectId(),key);
            if(!existing.isEmpty()){if(!hash.equals(existing.getFirst().get("request_hash")))throw new ResponseStatusException(HttpStatus.CONFLICT);return get(user,(UUID)existing.getFirst().get("id"));}
            if(jdbc.queryForObject("SELECT count(*) FROM stack_campaigns WHERE organization_id=? AND project_id=?",Integer.class,user.organizationId(),user.projectId())>=200)throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS);
            lifecycle.lock(user);lifecycle.requireActive(user,"agents",agentId);lifecycle.requireActive(user,"datasets",datasetId);
            var agent=versions.get(user,"agents",agentId);var dataset=versions.get(user,"datasets",datasetId);
            if(baselineId!=null){
                var baseline=get(user,baselineId);lifecycle.requireActive(user,"agents",(UUID)baseline.get("agent_version_id"));lifecycle.requireActive(user,"datasets",(UUID)baseline.get("dataset_version_id"));
                CampaignReleaseRequirements.compatible(Map.of("agentVersion",agent,"dataset_version_id",datasetId,"dataset_content_sha256",dataset.get("content_sha256")),baseline);
                if(baseline.get("state").equals("queued"))throw new ResponseStatusException(HttpStatus.CONFLICT);
            }
            JsonNode definition=(JsonNode)agent.get("definition"),data=(JsonNode)dataset.get("definition");
            String agentContract=definition.path("contract").asText(),datasetContract=data.path("contract").asText();
            boolean reference=agentContract.equals(QualityDefinition.CONTRACT)&&datasetContract.equals(QualityDefinition.CONTRACT);
            if(!reference&&(!List.of(VersionDefinition.CONTRACT,"fixed-scenarios-v2").contains(agentContract)||!datasetContract.equals(VersionDefinition.CONTRACT)))throw new ResponseStatusException(HttpStatus.CONFLICT);
            String provider=definition.path("provider").asText();JsonNode cases=data.path("cases");
            // Keep real-provider batches bounded under the existing per-case reservation and deadline.
            if(!provider.equals("synthetic")&&cases.size()>2)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
            UUID id=UUID.randomUUID();jdbc.update("INSERT INTO stack_campaigns(id,organization_id,project_id,actor_id,idempotency_key,request_hash,agent_version_id,dataset_version_id,agent_content_sha256,dataset_content_sha256,requires_approval) VALUES(?,?,?,?,?,?,?,?,?,?,?)",id,user.organizationId(),user.projectId(),user.actorId(),key,hash,agentId,datasetId,agent.get("content_sha256"),dataset.get("content_sha256"),approval);
            if(baselineId!=null)jdbc.update("INSERT INTO stack_campaign_release_requirements(campaign_id,organization_id,project_id,baseline_campaign_id,evidence_max_age_seconds) VALUES(?,?,?,?,?)",id,user.organizationId(),user.projectId(),baselineId,maxAge);
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
    public Map<String,Object> reviewHistory(DemoUser user,UUID id){return runs.scoped(user,()->{admission(user,id);return Map.of("campaignId",id,"organizationId",user.organizationId(),"projectId",user.projectId(),"entries",reviews(user,id),"limit",50,"deploymentAuthority",false);});}
    public Map<String,Object> review(DemoUser user,UUID id,String decision,String reason){
        if(!user.role().equals("admin"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if(decision==null||!List.of("approved","rejected").contains(decision)||reason==null||reason.isBlank()||reason.length()>500)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return runs.scoped(user,()->{jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign-review/"+id);var value=get(user,id);
            if(!value.get("decision").equals("pass"))throw new ResponseStatusException(HttpStatus.CONFLICT);
            if(decision.equals("approved")&&!activeLifecycle(versionLifecycle(user,id)))throw new ResponseStatusException(HttpStatus.CONFLICT,"Campaign version retired");
            UUID review=UUID.randomUUID();jdbc.update("INSERT INTO stack_campaign_reviews(id,campaign_id,organization_id,project_id,actor_id,decision,reason,policy_version,policy_digest) VALUES(?,?,?,?,?,?,?,?,?)",review,id,user.organizationId(),user.projectId(),user.actorId(),decision,reason.strip(),policy.version(),policy.digest());runs.audit(user,"campaign.review."+decision,id);return Map.of("id",review,"decision",decision);
        });
    }
    public Evaluation.Gate gate(DemoUser user,UUID id){return runs.scoped(user,()->{
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign-review/"+id);var value=get(user,id);value.put("result",mapper.valueToTree(value.get("result")));value.put("releaseRequirements",releaseRequirements(user,id));value.put("versionLifecycle",versionLifecycle(user,id));var reviews=reviews(user,id);return policy.decide(user,id,value,reviews.isEmpty()?null:reviews.getFirst());
    });}
    public Map<String,Object> versionLifecycle(DemoUser user,UUID id){return runs.scoped(user,()->{
        lifecycle.lock(user);var record=admission(user,id);var entries=new ArrayList<Map<String,Object>>();
        entries.add(lifecycle.get(user,"agents",(UUID)record.get("agent_version_id")));entries.add(lifecycle.get(user,"datasets",(UUID)record.get("dataset_version_id")));
        var requirements=jdbc.queryForList("SELECT baseline_campaign_id FROM stack_campaign_release_requirements WHERE campaign_id=? AND organization_id=? AND project_id=?",id,user.organizationId(),user.projectId());
        if(!requirements.isEmpty()){var baseline=admission(user,(UUID)requirements.getFirst().get("baseline_campaign_id"));entries.add(lifecycle.get(user,"agents",(UUID)baseline.get("agent_version_id")));entries.add(lifecycle.get(user,"datasets",(UUID)baseline.get("dataset_version_id")));}
        return Map.of("contract","campaign-version-lifecycle-v1","campaignId",id,"organizationId",user.organizationId(),"projectId",user.projectId(),"versions",entries,"deploymentAuthority",false);
    });}
    static boolean activeLifecycle(Map<String,Object> value){return ((List<?>)value.get("versions")).stream().allMatch(x->x instanceof Map<?,?> item&&"active".equals(item.get("state")));}
    public Map<String,Object> releaseRequirements(DemoUser user,UUID id){return runs.scoped(user,()->{
        var record=get(user,id);
        var rows=jdbc.queryForList("SELECT baseline_campaign_id,evidence_max_age_seconds FROM stack_campaign_release_requirements WHERE campaign_id=? AND organization_id=? AND project_id=?",id,user.organizationId(),user.projectId());
        String admittedHash=jdbc.queryForObject("SELECT request_hash FROM stack_campaigns WHERE id=? AND organization_id=? AND project_id=?",String.class,id,user.organizationId(),user.projectId());
        UUID admittedBaseline=rows.isEmpty()?null:(UUID)rows.getFirst().get("baseline_campaign_id");Integer admittedMaxAge=rows.isEmpty()?null:(Integer)rows.getFirst().get("evidence_max_age_seconds");
        if(!CampaignReleaseRequirements.requestHash((UUID)record.get("agent_version_id"),(UUID)record.get("dataset_version_id"),(Boolean)record.get("requires_approval"),admittedBaseline,admittedMaxAge).equals(admittedHash))throw new IllegalStateException("Campaign release requirements binding unavailable");
        var result=new java.util.TreeMap<String,Object>();result.put("contract","campaign-release-requirements-v1");result.put("campaignId",id);result.put("organizationId",user.organizationId());result.put("projectId",user.projectId());result.put("enabled",!rows.isEmpty());result.put("deploymentAuthority",false);
        if(rows.isEmpty())return result;
        var row=rows.getFirst();UUID baselineId=(UUID)row.get("baseline_campaign_id");int maxAge=(Integer)row.get("evidence_max_age_seconds");
        var baseline=get(user,baselineId);CampaignReleaseRequirements.compatible(record,baseline);
        long candidateCreated=CampaignReleaseRequirements.createdAt(record),baselineCreated=CampaignReleaseRequirements.createdAt(baseline);
        result.put("baselineCampaignId",baselineId);result.put("evidenceMaxAgeSeconds",maxAge);
        result.put("candidateCreatedAtEpochMillis",candidateCreated);result.put("baselineCreatedAtEpochMillis",baselineCreated);
        result.put("evidenceExpiresAtEpochMillis",Math.min(CampaignReleaseRequirements.expiresAt(candidateCreated,maxAge),CampaignReleaseRequirements.expiresAt(baselineCreated,maxAge)));
        result.put("baselineAgentVersionId",baseline.get("agent_version_id"));result.put("baselineAgentContentSha256",baseline.get("agent_content_sha256"));
        result.put("datasetVersionId",record.get("dataset_version_id"));result.put("datasetContentSha256",record.get("dataset_content_sha256"));
        result.put("comparison",CampaignAggregate.compare(cases(user,baselineId),cases(user,id)));
        return result;
    });}
    public Map<String,Object> cancel(DemoUser user,UUID id,String reason){
        if(!List.of("admin","editor").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        RunCancellation.reason(reason);
        return runs.scoped(user,()->{
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign-review/"+id);
            admission(user,id);UUID actor=jdbc.queryForObject("SELECT actor_id FROM stack_campaigns WHERE id=? AND organization_id=? AND project_id=?",UUID.class,id,user.organizationId(),user.projectId());RunCancellation.owner(user,actor);
            var children=cases(user,id);
            children.stream().map(c->c.runId().toString()).sorted().forEach(child->jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"completion/"+child));
            var record=get(user,id);children=cases(user,id);
            int changed=0;boolean previouslyCancelled=false;
            for(var child:children){
                if(child.state().equals("queued")){runs.cancel(user,child.runId(),reason);changed++;}
                else previouslyCancelled|=RunCancellation.cancelled((JsonNode)runs.get(user,child.runId()).get("result"));
            }
            if(changed==0&&!previouslyCancelled)throw new ResponseStatusException(HttpStatus.CONFLICT);
            if(changed>0)runs.audit(user,"campaign.cancelled",id);
            return get(user,id);
        });
    }
    public Map<String,Object> compare(DemoUser user,UUID id,UUID baseline){return runs.scoped(user,()->{
        if(id.equals(baseline))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        var current=get(user,id);var previous=get(user,baseline);
        CampaignReleaseRequirements.compatible(current,previous);
        if(current.get("state").equals("queued")||previous.get("state").equals("queued"))throw new ResponseStatusException(HttpStatus.CONFLICT);
        var comparison=CampaignAggregate.compare(cases(user,baseline),cases(user,id));
        return Map.of("campaignId",id,"baselineCampaignId",baseline,"organizationId",user.organizationId(),"projectId",user.projectId(),"datasetVersionId",current.get("dataset_version_id"),"datasetContentSha256",current.get("dataset_content_sha256"),"comparison",comparison);
    });}
}
