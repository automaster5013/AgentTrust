package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Read-only comparison of observed results, without granting release authority. */
@Service
public class RunComparison {
    private final RunService runs;
    public RunComparison(RunService runs){this.runs=runs;}
    public Map<String,Object> compare(DemoUser user,UUID candidateId,UUID baselineId){
        if(user==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if(!List.of("admin","editor","viewer").contains(user.role()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if(candidateId.equals(baselineId))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Choose two different evaluations");
        var baseline=read(user,baselineId);
        var candidate=read(user,candidateId);
        var before=rules(baseline);var after=rules(candidate);
        var ids=new TreeSet<String>();ids.addAll(before.keySet());ids.addAll(after.keySet());
        var changes=new ArrayList<Map<String,Object>>();int changed=0;
        for(String id:ids){
            JsonNode a=before.get(id),b=after.get(id);
            String from=a==null?"missing":a.path("status").asText(),to=b==null?"missing":b.path("status").asText();
            boolean differs=a==null||b==null||!from.equals(to)||a.path("required").asBoolean()!=b.path("required").asBoolean();
            if(differs)changed++;
            var row=new LinkedHashMap<String,Object>();row.put("ruleId",id);row.put("before",from);row.put("after",to);
            row.put("baselineRequired",a==null?null:a.path("required").asBoolean());row.put("candidateRequired",b==null?null:b.path("required").asBoolean());
            row.put("changed",differs);changes.add(row);
        }
        var result=new LinkedHashMap<String,Object>();result.put("organizationId",user.organizationId());result.put("projectId",user.projectId());
        result.put("baselineRunId",baselineId);result.put("candidateRunId",candidateId);result.put("comparisonKind","observed-rule-results-v1");
        result.put("baselineDecision",baseline.get("decision"));result.put("candidateDecision",candidate.get("decision"));
        result.put("rules",changes);result.put("changedRules",changed);result.put("deploymentAuthority",false);result.put("regressionAuthority",false);
        return result;
    }
    private Map<String,Object> read(DemoUser user,UUID id){
        var run=runs.get(user,id);
        if(!id.equals(run.get("id"))||!user.organizationId().equals(run.get("organization_id"))||!user.projectId().equals(run.get("project_id")))throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if(!List.of("succeeded","failed").contains(run.get("state")))throw new ResponseStatusException(HttpStatus.CONFLICT,"Evaluation is not complete");
        if(!List.of("pass","block","inconclusive").contains(run.get("decision")))throw new IllegalStateException("Invalid stored evaluation decision");
        return run;
    }
    private static Map<String,JsonNode> rules(Map<String,Object> run){
        if(!(run.get("result") instanceof JsonNode result)||!Objects.equals(result.path("state").asText(),run.get("state"))||!Objects.equals(result.path("decision").asText(),run.get("decision")))throw new IllegalStateException("Invalid stored evaluation result");
        JsonNode values=result.path("rules");
        if(!values.isArray()||values.isEmpty()||values.size()>100)throw new IllegalStateException("Invalid stored rule coverage");
        var rules=new LinkedHashMap<String,JsonNode>();
        for(JsonNode rule:values){
            String id=rule.path("id").asText();
            if(!rule.path("id").isTextual()||id.isBlank()||id.length()>100||!rule.path("status").isTextual()||!List.of("pass","fail","inconclusive").contains(rule.path("status").asText())||!rule.path("required").isBoolean()||rules.putIfAbsent(id,rule)!=null)throw new IllegalStateException("Invalid stored evaluation rule");
        }
        return rules;
    }
}
