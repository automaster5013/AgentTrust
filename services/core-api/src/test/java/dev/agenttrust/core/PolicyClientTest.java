package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class PolicyClientTest {
    private final ObjectMapper mapper=new ObjectMapper();private final String id="11111111-1111-4111-8111-111111111111",digest="sha256:"+"a".repeat(64);
    private Map<String,Object> input(){return Map.of("runId",id,"organizationId",id,"projectId",id,"approvalRequired",true,"state","succeeded","evaluationDecision","pass","latestReview","approved","reviewPolicyVersion","1.0.0","reviewPolicyDigest",digest);}
    private com.fasterxml.jackson.databind.node.ObjectNode decision(){return mapper.createObjectNode().put("runId",id).put("organizationId",id).put("projectId",id).put("policyVersion","1.0.0").put("policyDigest",digest).put("decision","pass").put("deploymentAllowed",true).put("currentReviewRequired",true).put("reason","Synthetic policy decision");}
    @Test void correctScopedVersionIsAccepted(){assertTrue(PolicyClient.validated(decision(),input(),"1.0.0",digest).deploymentAllowed());}
    @Test void wrongScopeVersionOrContradictoryPermissionIsRefused(){
        assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision().put("organizationId","foreign"),input(),"1.0.0",digest));
        assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision().put("policyDigest","sha256:"+"b".repeat(64)),input(),"1.0.0",digest));
        assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision().put("decision","block"),input(),"1.0.0",digest));
        assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision().put("deploymentAllowed","true"),input(),"1.0.0",digest));
        var old=new java.util.HashMap<>(input());old.put("reviewPolicyDigest","sha256:"+"b".repeat(64));
        assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision(),old,"1.0.0",digest));
    }
}
