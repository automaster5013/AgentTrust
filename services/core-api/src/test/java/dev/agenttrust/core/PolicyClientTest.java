package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class PolicyClientTest {
    private final ObjectMapper mapper=new ObjectMapper();private final String id="11111111-1111-4111-8111-111111111111",digest="sha256:"+"a".repeat(64);
    private Map<String,Object> input(){var value=new java.util.HashMap<String,Object>(Map.of("runId",id,"organizationId",id,"projectId",id,"approvalRequired",true,"state","succeeded","evaluationDecision","pass","latestReview","approved","reviewPolicyVersion","1.0.0","reviewPolicyDigest",digest));value.put("nowEpochMillis",2_000_000_000_000L);value.put("reviewCreatedAtEpochMillis",1_999_999_999_999L);return value;}
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
    @Test void approvalTimeExpiresAtExactDeadline() {
        var value=input();value.put("reviewCreatedAtEpochMillis",1_999_996_400_001L);
        assertTrue(PolicyClient.validated(decision(),value,"1.0.0",digest).deploymentAllowed());
        value.put("reviewCreatedAtEpochMillis",1_999_996_400_000L);
        assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision(),value,"1.0.0",digest));
    }
    @Test void invalidAndFutureApprovalTimesCannotAuthorizeRelease() {
        for(Object timestamp:java.util.List.of(1_999_996_399_999L,2_000_000_000_001L,0L,-1L,"1999999999999",1_999_999_999_999.5,Double.NaN,Double.POSITIVE_INFINITY,9_007_199_254_740_992L)) {
            var value=input();value.put("reviewCreatedAtEpochMillis",timestamp);
            assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision(),value,"1.0.0",digest));
        }
        var missing=input();missing.remove("reviewCreatedAtEpochMillis");
        assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision(),missing,"1.0.0",digest));
    }
    @Test void invalidTrustedClockCannotAuthorizeRelease() {
        for(Object timestamp:java.util.List.of(0L,-1L,"2000000000000",2_000_000_000_000.5,Double.NaN,9_007_199_254_740_992L)) {
            var value=input();value.put("nowEpochMillis",timestamp);
            assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision(),value,"1.0.0",digest));
        }
    }
    @Test void approvalCannotOverrideExpiredOrUnresolvedBaseline() {
        var value=input();var requirement=mapper.createObjectNode().put("enabled",true).put("evidenceMaxAgeSeconds",60)
            .put("candidateCreatedAtEpochMillis",1_999_999_999_999L).put("baselineCreatedAtEpochMillis",1_999_999_940_001L);
        requirement.putObject("comparison").put("status","no-regression");value.put("releaseRequirements",requirement);
        assertTrue(PolicyClient.validated(decision(),value,"1.0.0",digest).deploymentAllowed());
        requirement.put("baselineCreatedAtEpochMillis",1_999_999_940_000L);
        assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision(),value,"1.0.0",digest));
        requirement.put("baselineCreatedAtEpochMillis",1_999_999_999_999L);
        for(String status:java.util.List.of("inconclusive","regression","unknown")){
            ((com.fasterxml.jackson.databind.node.ObjectNode)requirement.path("comparison")).put("status",status);
            assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision(),value,"1.0.0",digest));
        }
        value.put("releaseRequirements",mapper.createObjectNode().put("enabled","false"));
        assertThrows(IllegalArgumentException.class,()->PolicyClient.validated(decision(),value,"1.0.0",digest));
    }
}
