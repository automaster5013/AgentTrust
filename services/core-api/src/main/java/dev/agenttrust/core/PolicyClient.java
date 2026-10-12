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
            input.put("releaseRequirements",mapper.valueToTree(run.getOrDefault("releaseRequirements",Map.of("enabled",false))));
            if(run.containsKey("versionLifecycle")){
                input.put("versionLifecycle",mapper.valueToTree(run.get("versionLifecycle")));
                for(String key:List.of("agent","dataset")){input.put(key+"VersionId",run.get(key+"_version_id").toString());input.put(key+"ContentSha256",run.get(key+"_content_sha256"));}
            }
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
        if(allowed&&!currentReleaseRequirements(input))throw new IllegalArgumentException("Unresolved or expired release baseline");
        if(allowed&&!activeVersionLifecycle(input))throw new IllegalArgumentException("Retired or invalid version lifecycle");
        return new Evaluation.Gate(decision,allowed,reason,false,approval,"opa-rego","evaluated",version,digest);
    }
    static boolean currentApprovalTime(Map<String,Object> input) {
        Long now=epochMillis(input.get("nowEpochMillis")),created=epochMillis(input.get("reviewCreatedAtEpochMillis"));
        return now!=null&&created!=null&&now>=created&&now-created<APPROVAL_TTL_MILLIS;
    }
    static boolean activeVersionLifecycle(Map<String,Object> input){
        Object raw=input.get("versionLifecycle");if(raw==null)return true;
        if(!(raw instanceof JsonNode value)||!value.isObject()||!value.path("contract").asText().equals("campaign-version-lifecycle-v1")||!value.path("versions").isArray()||!List.of(2,4).contains(value.path("versions").size()))return false;
        if(value.size()!=6||!value.path("campaignId").asText().equals(input.get("runId"))||!value.path("organizationId").asText().equals(input.get("organizationId"))||!value.path("projectId").asText().equals(input.get("projectId"))||!value.path("deploymentAuthority").isBoolean()||value.path("deploymentAuthority").booleanValue())return false;
        JsonNode requirements=input.get("releaseRequirements") instanceof JsonNode node?node:null;
        boolean bound=requirements!=null&&requirements.path("enabled").asBoolean();
        if(value.path("versions").size()!=(bound?4:2))return false;
        for(int i=0;i<value.path("versions").size();i++){
            var entry=value.path("versions").get(i);
            if(!entry.isObject()||entry.size()!=8||!entry.path("state").asText().equals("active")||!entry.path("contract").asText().equals("version-lifecycle-v1")||!entry.path("kind").asText().equals(i%2==0?"agents":"datasets")||!entry.path("versionId").asText().matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")||!entry.path("contentSha256").asText().matches("[a-f0-9]{64}")||!entry.path("organizationId").equals(value.path("organizationId"))||!entry.path("projectId").equals(value.path("projectId"))||!entry.path("deploymentAuthority").isBoolean()||entry.path("deploymentAuthority").booleanValue())return false;
            Object expectedId=i==2?requirements.path("baselineAgentVersionId").asText():input.get(i%2==0?"agentVersionId":"datasetVersionId");
            Object expectedHash=i==2?requirements.path("baselineAgentContentSha256").asText():input.get(i%2==0?"agentContentSha256":"datasetContentSha256");
            if(!entry.path("versionId").asText().equals(expectedId)||!entry.path("contentSha256").asText().equals(expectedHash))return false;
        }
        return true;
    }
    static boolean currentReleaseRequirements(Map<String,Object> input) {
        Object raw=input.get("releaseRequirements");
        if(raw==null)return true; // Existing callers retain their original single-evaluation contract.
        if(!(raw instanceof JsonNode value)||!value.isObject()||!value.path("enabled").isBoolean())return false;
        if(!value.path("enabled").booleanValue())return true;
        var age=value.path("evidenceMaxAgeSeconds");var candidate=value.path("candidateCreatedAtEpochMillis");var baseline=value.path("baselineCreatedAtEpochMillis");
        Long now=epochMillis(input.get("nowEpochMillis"));
        if(now==null||!age.isIntegralNumber()||!age.canConvertToInt()||age.intValue()<60||age.intValue()>86400
            ||!candidate.isIntegralNumber()||!baseline.isIntegralNumber()||!candidate.canConvertToLong()||!baseline.canConvertToLong()
            ||baseline.longValue()>candidate.longValue()||!value.path("comparison").path("status").asText().equals("no-regression"))return false;
        try{return CampaignReleaseRequirements.current(now,candidate.longValue(),baseline.longValue(),age.intValue());}
        catch(IllegalArgumentException invalid){return false;}
    }
    private static Long epochMillis(Object value) {
        if(!(value instanceof Number number))return null;
        double millis=number.doubleValue();
        if(!Double.isFinite(millis)||millis<1||millis>9_007_199_254_740_991L||millis!=Math.rint(millis))return null;
        return number.longValue();
    }
}
