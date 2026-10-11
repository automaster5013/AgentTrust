package dev.agenttrust.core;

import java.sql.Timestamp;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CampaignReleaseRequirementsTest {
    private final long now=2_000_000_000_000L;
    private Map<String,Object> record(UUID dataset,String hash,String key){return Map.of("dataset_version_id",dataset,"dataset_content_sha256",hash,"agentVersion",Map.of("resource_key",key));}
    @Test void baselineAndBoundMustBeProvidedTogether(){
        assertDoesNotThrow(()->CampaignReleaseRequirements.parameters(null,null));
        assertDoesNotThrow(()->CampaignReleaseRequirements.parameters(UUID.randomUUID(),60));
        assertDoesNotThrow(()->CampaignReleaseRequirements.parameters(UUID.randomUUID(),86400));
        for(Integer age:new Integer[]{null,0,59,86401,Integer.MAX_VALUE})assertThrows(Exception.class,()->CampaignReleaseRequirements.parameters(UUID.randomUUID(),age));
        assertThrows(Exception.class,()->CampaignReleaseRequirements.parameters(null,3600));
    }
    @Test void requestFingerprintPreservesLegacyReplayAndBindsEveryReleaseCondition(){
        UUID a=UUID.randomUUID(),d=UUID.randomUUID(),b=UUID.randomUUID();
        String old=ArchiveIntegrity.sha256(("campaign/v1\n"+a+"\n"+d+"\ntrue").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertEquals(old,CampaignReleaseRequirements.requestHash(a,d,true,null,null));
        String bound=CampaignReleaseRequirements.requestHash(a,d,true,b,60);
        assertNotEquals(old,bound);assertNotEquals(bound,CampaignReleaseRequirements.requestHash(a,d,true,UUID.randomUUID(),60));
        assertNotEquals(bound,CampaignReleaseRequirements.requestHash(a,d,true,b,61));
        assertNotEquals(bound,CampaignReleaseRequirements.requestHash(a,d,false,b,60));
    }
    @Test void bothEvidenceWindowsHaveExclusiveDeadlineAndFutureDatesAreDenied(){
        assertTrue(CampaignReleaseRequirements.current(now,now-1,now-59_999,60));
        assertFalse(CampaignReleaseRequirements.current(now,now-1,now-60_000,60));
        assertFalse(CampaignReleaseRequirements.current(now,now-60_000,now-1,60));
        assertFalse(CampaignReleaseRequirements.current(now,now+1,now,60));
        assertFalse(CampaignReleaseRequirements.current(now,now,now+1,60));
        assertThrows(IllegalArgumentException.class,()->CampaignReleaseRequirements.expiresAt(Long.MAX_VALUE,60));
    }
    @Test void immutableDatasetAndAgentNameCannotBeSubstituted(){
        UUID id=UUID.randomUUID();var a=record(id,"a".repeat(64),"agent");
        assertDoesNotThrow(()->CampaignReleaseRequirements.compatible(a,record(id,"a".repeat(64),"agent")));
        for(var b:java.util.List.of(record(UUID.randomUUID(),"a".repeat(64),"agent"),record(id,"b".repeat(64),"agent"),record(id,"a".repeat(64),"other")))assertThrows(Exception.class,()->CampaignReleaseRequirements.compatible(a,b));
    }
    @Test void onlyStoredTimestampCanSupplyEvidenceAge(){
        assertEquals(now,CampaignReleaseRequirements.createdAt(Map.of("created_at",new Timestamp(now))));
        for(Object value:java.util.List.of(now,"2099-01-01T00:00:00Z",new Timestamp(0)))assertThrows(IllegalArgumentException.class,()->CampaignReleaseRequirements.createdAt(Map.of("created_at",value)));
    }
}
