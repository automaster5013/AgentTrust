package dev.agenttrust.core;
import java.time.Instant;
import java.util.UUID;
import java.nio.ByteBuffer;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class CampaignHistoryCursorTest {
    private static final UUID ORG=UUID.randomUUID(),PROJECT=UUID.randomUUID(),DATASET=UUID.randomUUID(),ID=UUID.fromString("ffffffff-ffff-4fff-8fff-ffffffffffff");
    private static final DemoUser USER=new DemoUser("reader","unused",ORG,PROJECT,ID,"viewer");
    private CampaignHistoryCursor cursor(UUID dataset){return new CampaignHistoryCursor(ORG,PROJECT,dataset,Instant.parse("2026-10-11T05:00:00.123456Z"),ID);}
    @Test void microsecondsDatasetAndAllHistoryRemainDistinct(){for(UUID dataset:new UUID[]{null,DATASET,new UUID(0,0)}){var original=cursor(dataset);assertEquals(107,original.encode().length());assertEquals(original,CampaignHistoryCursor.decode(original.encode(),USER,dataset));}}
    @Test void foreignScopeAndChangedDatasetCannotReuseBoundary(){
        assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(cursor(DATASET).encode(),new DemoUser("foreign","unused",UUID.randomUUID(),PROJECT,ID,"admin"),DATASET));
        assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(cursor(DATASET).encode(),new DemoUser("foreign-project","unused",ORG,UUID.randomUUID(),ID,"admin"),DATASET));
        for(UUID dataset:new UUID[]{null,UUID.randomUUID()})assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(cursor(DATASET).encode(),USER,dataset));
        assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(cursor(null).encode(),USER,DATASET));
    }
    @Test void wrongDomainNoncanonicalEncodingAndImpossibleTimestampAreRejected(){
        String token=cursor(DATASET).encode();for(String invalid:new String[]{"",token+"=",token.substring(1),token+"/../../runs"})assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(invalid,USER,DATASET));
        for(int offset:new int[]{0,35,52}){var bytes=Base64.getUrlDecoder().decode(token);bytes[offset]=(byte)255;assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),USER,DATASET));}
        for(int nanos:new int[]{-1,1,1_000_000_000}){var bytes=Base64.getUrlDecoder().decode(token);ByteBuffer.wrap(bytes).putInt(60,nanos);assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),USER,DATASET));}
        for(long seconds:new long[]{-1,Long.MAX_VALUE}){var bytes=Base64.getUrlDecoder().decode(token);ByteBuffer.wrap(bytes).putLong(52,seconds);assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),USER,DATASET));}
        String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",noncanonical=token.substring(0,106)+alphabet.charAt(alphabet.indexOf(token.charAt(106))+1);assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(noncanonical,USER,DATASET));
        var bytes=Base64.getUrlDecoder().decode(token);bytes[35]=0;assertThrows(IllegalArgumentException.class,()->CampaignHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),USER,null));
    }
}
