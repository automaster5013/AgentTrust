package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class PolicyClient {
    private final ObjectMapper mapper;private final String token,version,digest;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).followRedirects(HttpClient.Redirect.NEVER).build();
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
            var request=HttpRequest.newBuilder(URI.create("http://stack-opa:8181/v1/data/agenttrust/release/decision")).timeout(Duration.ofSeconds(2)).header("Content-Type","application/json").header("Authorization","Bearer "+token).POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(Map.of("input",input)))).build();
            var response=client.send(request,HttpResponse.BodyHandlers.ofInputStream());byte[] bytes;try(var stream=response.body()){bytes=stream.readNBytes(4097);}
            if(response.statusCode()!=200||bytes.length>4096)throw new IllegalStateException("Policy response unavailable");
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
        return new Evaluation.Gate(decision,allowed,reason,false,approval,"opa-rego","evaluated",version,digest);
    }
}
