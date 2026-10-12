package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CampaignLifecycleBindingTest {
    private ObjectNode payload(){
        var mapper=new ObjectMapper();String org=UUID.randomUUID().toString(),project=UUID.randomUUID().toString(),campaign=UUID.randomUUID().toString(),agent=UUID.randomUUID().toString(),dataset=UUID.randomUUID().toString(),hash="a".repeat(64);
        var result=mapper.createObjectNode();result.put("campaignId",campaign).put("organizationId",org).put("projectId",project).put("agentVersionId",agent).put("datasetVersionId",dataset).put("agentContentSha256",hash).put("datasetContentSha256",hash).put("issuedAt","2026-10-12T02:00:00Z");
        result.set("observedGate",mapper.valueToTree(Map.of("deploymentAllowed",true)));
        result.set("versionLifecycle",mapper.valueToTree(Map.of("contract","campaign-version-lifecycle-v1","campaignId",campaign,"organizationId",org,"projectId",project,"deploymentAuthority",false,"versions",List.of(
            Map.of("contract","version-lifecycle-v1","kind","agents","versionId",agent,"organizationId",org,"projectId",project,"contentSha256",hash,"state","active","deploymentAuthority",false),
            Map.of("contract","version-lifecycle-v1","kind","datasets","versionId",dataset,"organizationId",org,"projectId",project,"contentSha256",hash,"state","active","deploymentAuthority",false)))));
        return result;
    }
    @Test void bindsScopeContentAndOrdering(){
        assertDoesNotThrow(()->CampaignLifecycleBinding.verify(payload()));
        for(String key:List.of("organizationId","projectId","versionId","contentSha256","kind")){
            var value=payload();((ObjectNode)value.path("versionLifecycle").path("versions").get(0)).put(key,"altered");
            assertThrows(IllegalArgumentException.class,()->CampaignLifecycleBinding.verify(value));
        }
    }
    @Test void retirementCannotAuthorizeOrPostdateObservation(){
        var value=payload();var entry=(ObjectNode)value.path("versionLifecycle").path("versions").get(0);
        entry.put("state","retired").put("retiredBy",UUID.randomUUID().toString()).put("reason","Superseded version").put("retiredAt","2026-10-12T01:00:00Z");
        assertThrows(IllegalArgumentException.class,()->CampaignLifecycleBinding.verify(value));
        ((ObjectNode)value.path("observedGate")).put("deploymentAllowed",false);
        assertDoesNotThrow(()->CampaignLifecycleBinding.verify(value));
        entry.put("retiredAt","2026-10-12T03:00:00Z");
        assertThrows(IllegalArgumentException.class,()->CampaignLifecycleBinding.verify(value));
    }
}
