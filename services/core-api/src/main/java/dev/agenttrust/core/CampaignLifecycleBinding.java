package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Independent validation of lifecycle evidence inside immutable signed observations. */
final class CampaignLifecycleBinding {
    private CampaignLifecycleBinding() {}
    static void verify(JsonNode payload) {
        JsonNode life=payload.path("versionLifecycle"),requirements=payload.path("releaseRequirements");
        boolean bound=requirements.path("enabled").asBoolean();
        require(life.isObject()&&life.size()==6&&life.path("contract").asText().equals("campaign-version-lifecycle-v1"));
        for(String key:new String[]{"campaignId","organizationId","projectId"})require(life.path(key).equals(payload.path(key)));
        require(life.path("deploymentAuthority").isBoolean()&&!life.path("deploymentAuthority").booleanValue());
        JsonNode versions=life.path("versions");require(versions.isArray()&&versions.size()==(bound?4:2));
        Map<String,JsonNode> seen=new HashMap<>();
        require(payload.path("observedGate").path("deploymentAllowed").isBoolean());
        Instant observed=Instant.parse(payload.path("issuedAt").asText());
        for(int i=0;i<versions.size();i++){
            JsonNode entry=versions.get(i);boolean agent=i%2==0;
            String id=i==2?requirements.path("baselineAgentVersionId").asText():payload.path(agent?"agentVersionId":"datasetVersionId").asText();
            String hash=i==2?requirements.path("baselineAgentContentSha256").asText():payload.path(agent?"agentContentSha256":"datasetContentSha256").asText();
            require(entry.isObject()&&entry.path("contract").asText().equals("version-lifecycle-v1")&&entry.path("kind").asText().equals(agent?"agents":"datasets"));
            require(entry.path("versionId").asText().equals(id)&&UUID.fromString(id).toString().equals(id)&&hash.matches("[a-f0-9]{64}")&&entry.path("contentSha256").asText().equals(hash));
            for(String key:new String[]{"organizationId","projectId"})require(entry.path(key).equals(payload.path(key)));
            require(entry.path("deploymentAuthority").isBoolean()&&!entry.path("deploymentAuthority").booleanValue());
            String state=entry.path("state").asText();
            if(state.equals("active"))require(entry.size()==8);
            else {
                require(state.equals("retired")&&entry.size()==11&&entry.path("reason").isTextual()&&!entry.path("reason").asText().isBlank()&&entry.path("reason").asText().length()<=500);
                String actor=entry.path("retiredBy").asText();require(UUID.fromString(actor).toString().equals(actor));
                require(!Instant.parse(entry.path("retiredAt").asText()).isAfter(observed)&&!payload.path("observedGate").path("deploymentAllowed").asBoolean());
            }
            String key=(agent?"agents/":"datasets/")+id;JsonNode prior=seen.putIfAbsent(key,entry);require(prior==null||prior.equals(entry));
        }
    }
    private static void require(boolean valid){if(!valid)throw new IllegalArgumentException("Signed lifecycle binding mismatch");}
}
