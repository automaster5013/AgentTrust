package dev.agenttrust.core;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Aggregates stored per-case evidence. No missing or failed execution can become a pass. */
public final class CampaignAggregate {
    public record CaseEvidence(String caseId,boolean required,UUID runId,String scenario,String provider,String state,String decision) {}
    public record Result(String state,String decision,List<Evaluation.Rule> rules,String executionEngine) {}
    public record Comparison(String status,List<String> newlyFailedRequiredCases,List<String> unresolvedRequiredCases,List<String> improvedRequiredCases,boolean deploymentAuthority) {}
    static Result result(List<CaseEvidence> cases) {
        if(cases==null||cases.isEmpty()||cases.size()>8)throw new IllegalArgumentException("Invalid campaign evidence");
        boolean queued=false,error=false,failed=false,missing=false,required=false;var seen=new HashSet<String>();var rules=new ArrayList<Evaluation.Rule>();
        for(var c:cases) {
            if(c==null||!seen.add(c.caseId())||!List.of("queued","succeeded","failed").contains(c.state())||!List.of("pass","block","inconclusive").contains(c.decision())||!c.state().equals("succeeded")&&!c.decision().equals("inconclusive"))throw new IllegalArgumentException("Invalid case evidence");
            queued|=c.state().equals("queued");error|=c.state().equals("failed");required|=c.required();
            String status=c.decision().equals("pass")?"pass":c.decision().equals("block")?"fail":"inconclusive";
            if(c.required()){failed|=status.equals("fail");missing|=status.equals("inconclusive");}
            rules.add(new Evaluation.Rule("case/"+c.caseId(),c.required(),status,"Stored case "+c.caseId()+": "+c.state()+" / "+c.decision()+"."));
        }
        String state=queued?"queued":error?"failed":"succeeded";
        String decision=queued||error?"inconclusive":failed?"block":missing||!required?"inconclusive":"pass";
        return new Result(state,decision,List.copyOf(rules),"java-campaign-aggregate");
    }
    static Comparison compare(List<CaseEvidence> baseline,List<CaseEvidence> candidate) {
        if(baseline.size()!=candidate.size())throw new IllegalArgumentException("Incompatible case evidence");
        var failures=new ArrayList<String>();var unresolved=new ArrayList<String>();var improved=new ArrayList<String>();
        for(int i=0;i<baseline.size();i++){
            var a=baseline.get(i);var b=candidate.get(i);
            if(!a.caseId().equals(b.caseId())||a.required()!=b.required()||!a.scenario().equals(b.scenario()))throw new IllegalArgumentException("Incompatible case evidence");
            if(!b.required())continue;
            if(!a.state().equals("succeeded")||a.decision().equals("inconclusive")||!b.state().equals("succeeded")||b.decision().equals("inconclusive"))unresolved.add(b.caseId());
            if(a.decision().equals("pass")&&b.decision().equals("block"))failures.add(b.caseId());
            if(a.decision().equals("block")&&b.decision().equals("pass"))improved.add(b.caseId());
        }
        boolean executionError=baseline.stream().anyMatch(c->!c.state().equals("succeeded"))||candidate.stream().anyMatch(c->!c.state().equals("succeeded"));
        return new Comparison(executionError||!unresolved.isEmpty()?"inconclusive":!failures.isEmpty()?"regression":"no-regression",List.copyOf(failures),List.copyOf(unresolved),List.copyOf(improved),false);
    }
}
