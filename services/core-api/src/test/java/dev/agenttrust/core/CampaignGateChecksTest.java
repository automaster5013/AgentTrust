package dev.agenttrust.core;

import java.sql.Timestamp;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CampaignGateChecksTest {
    private final long now=2_000_000_000_000L;
    private Evaluation.Gate gate(boolean allowed,boolean required){return new Evaluation.Gate(allowed?"pass":"block",allowed,"fixture",false,required,"opa-rego","evaluated","1.0.0","sha256:"+"a".repeat(64));}
    @Test void malformedChallengeIsRejectedBeforeRemoteWork(){
        assertDoesNotThrow(()->CampaignGateChecks.challenge("a".repeat(64)));
        for(String value:new String[]{null,"a".repeat(63),"A".repeat(64),"../"+"a".repeat(64),"a".repeat(65)})assertThrows(Exception.class,()->CampaignGateChecks.challenge(value));
    }
    @Test void freshnessCannotOutliveThirtySeconds(){assertEquals(now+30_000,CampaignGateChecks.expiry(now,gate(true,false),null));assertEquals(now+30_000,CampaignGateChecks.expiry(now,gate(false,true),null));}
    @Test void permittedCheckCannotOutliveApproval(){
        assertEquals(now+1,CampaignGateChecks.expiry(now,gate(true,true),Map.of("decision","approved","created_at",new Timestamp(now-3_599_999))));
        assertEquals(now+30_000,CampaignGateChecks.expiry(now,gate(true,true),Map.of("decision","approved","created_at",new Timestamp(now))));
    }
    @Test void expiredOrFutureApprovalCannotProducePermittedCheck(){
        for(long time:new long[]{now-3_600_000,now+1,0})assertThrows(IllegalArgumentException.class,()->CampaignGateChecks.expiry(now,gate(true,true),Map.of("decision","approved","created_at",new Timestamp(time))));
        assertThrows(IllegalArgumentException.class,()->CampaignGateChecks.expiry(now,gate(true,true),null));
        assertThrows(IllegalArgumentException.class,()->CampaignGateChecks.expiry(now,gate(true,true),Map.of("decision","rejected","created_at",new Timestamp(now))));
    }
    @Test void invalidClockCannotCreateFreshnessClaim(){for(long time:new long[]{0,-1,Long.MAX_VALUE})assertThrows(IllegalArgumentException.class,()->CampaignGateChecks.expiry(time,gate(false,false),null));}
    @Test void permittedCheckCannotOutliveBaselineEvidence(){
        assertEquals(now+1,CampaignGateChecks.expiry(now,gate(true,false),null,Map.of("enabled",true,"evidenceExpiresAtEpochMillis",now+1)));
        assertThrows(IllegalArgumentException.class,()->CampaignGateChecks.expiry(now,gate(true,false),null,Map.of("enabled",true,"evidenceExpiresAtEpochMillis",now)));
        assertEquals(now+30000,CampaignGateChecks.expiry(now,gate(false,false),null,Map.of("enabled",true,"evidenceExpiresAtEpochMillis",now-1)));
    }
}
