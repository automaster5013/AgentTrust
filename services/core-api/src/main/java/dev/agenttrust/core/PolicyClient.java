package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class PolicyClient {
    static final long APPROVAL_TTL_MILLIS=3_600_000L;
    private final ObjectMapper mapper;private final String token,version,digest;
    private final BoundedJsonHttp client=new BoundedJsonHttp();
    public PolicyClient(ObjectMapper mapper) throws Exception {
        this.mapper=mapper;token=Files.readString(Path.of("/run/secrets/stack-opa-token"));if(!token.matches("[a-f0-9]{64}"))throw new IllegalStateException("Policy configuration unavailable");
        try(var stream=PolicyClient.class.getResourceAsStream("/policy-metadata.json")){var metadata=mapper.readTree(stream).path("agenttrust").path("policy");version=metadata.path("version").asText();digest=metadata.path("digest").asText();}
        if(!version.matches("[0-9]+\\.[0-9]+\\.[0-9]+")||!digest.matches("sha256:[a-f0-9]{64}"))throw new IllegalStateException("Trusted policy metadata unavailable");
    }
    String version(){return version;}String digest(){return digest;}
    Evaluation.Gate decide(DemoUser user,UUID id,Map<String,Object> run,Map<String,Object> review) {
        boolean approval=(Boolean)run.get("requires_approval");String evaluation=(String)run.get("decision");
        try {
            var input=new HashMap<String,Object>();input.put("runId",id.toString());input.put("organizationId",user.organizationId().toString());input.put("projectId",user.projectId().toString());input.put("state",run.get("state"));input.put("evaluationDecision",evaluation);input.put("approvalRequired",approval);input.put("latestReview",review==null?"":review.get("decision"));input.put("reviewPolicyVersion",review==null?"":review.get("policy_version"));input.put("reviewPolicyDigest",review==null?"":review.get("policy_digest"));input.put("rules",((JsonNode)run.get("result")).path("rules"));
            input.put("nowEpochMillis",System.currentTimeMillis());
            input.put("reviewCreatedAtEpochMillis",review!=null && review.get("created_at") instanceof java.sql.Timestamp timestamp?timestamp.getTime():0L);
            byte[] bytes=client.post("http://stack-opa:8181/v1/data/agenttrust/release/decision","Authorization","Bearer "+token,mapper.writeValueAsBytes(Map.of("input",input)),4096);
            var result=mapper.readTree(bytes).path("result");return validated(result,input,version,digest);
        }catch(Exception error){if(error instanceof InterruptedException)Thread.currentThread().interrupt();return new Evaluation.Gate(evaluation.equals("block")?"block":"inconclusive",false,"OPA policy response or version binding was unavailable.",false,approval,"opa-rego","unavailable",version,digest);}
    }
    static Evaluation.Gate validated(JsonNode result,Map<String,Object> input,String version,String digest) {
        for(String key:List.of("runId","organizationId","projectId"))if(!input.get(key).equals(result.path(key).asText()))throw new IllegalArgumentException("Policy scope mismatch");
        if(!version.equals(result.path("policyVersion").asText())||!digest.equals(result.path("policyDigest").asText()))throw new IllegalArgumentException("Policy version mismatch");
        String decision=result.path("decision").asText(),reason=result.path("reason").asText();boolean allowed=result.path("deploymentAllowed").asBoolean(),approval=(Boolean)input.get("approvalRequired");
        if(!result.path("deploymentAllowed").isBoolean()||!result.path("currentReviewRequired").isBoolean()||approval!=result.path("currentReviewRequired").asBoolean()||!List.of("pass","block","inconclusive").contains(decision)||reason.isBlank()||reason.length()>500||allowed!=decision.equals("pass"))throw new IllegalArgumentException("Invalid policy decision");
        if(allowed && (!"succeeded".equals(input.get("state"))||!"pass".equals(input.get("evaluationDecision"))||"rejected".equals(input.get("latestReview"))||approval&&!"approved".equals(input.get("latestReview"))))throw new IllegalArgumentException("Contradictory policy permission");
        if(allowed&&approval&&(!version.equals(input.get("reviewPolicyVersion"))||!digest.equals(input.get("reviewPolicyDigest"))))throw new IllegalArgumentException("Outdated policy approval");
        if(allowed&&approval&&!currentApprovalTime(input))throw new IllegalArgumentException("Expired or invalid approval time");
        return new Evaluation.Gate(decision,allowed,reason,false,approval,"opa-rego","evaluated",version,digest);
    }
    static boolean currentApprovalTime(Map<String,Object> input) {
        Long now=epochMillis(input.get("nowEpochMillis")),created=epochMillis(input.get("reviewCreatedAtEpochMillis"));
        return now!=null&&created!=null&&now>=created&&now-created<APPROVAL_TTL_MILLIS;
    }
    private static Long epochMillis(Object value) {
        if(!(value instanceof Number number))return null;
        double millis=number.doubleValue();
        if(!Double.isFinite(millis)||millis<1||millis>9_007_199_254_740_991L||millis!=Math.rint(millis))return null;
        return number.longValue();
    }
}
