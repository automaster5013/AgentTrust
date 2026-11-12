package dev.agenttrust.core;
import java.time.Instant;
import java.util.UUID;
import java.nio.ByteBuffer;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class ReceiptHistoryCursorTest {
    private static final UUID ORG=UUID.randomUUID(),PROJECT=UUID.randomUUID(),CAMPAIGN=UUID.randomUUID(),ID=UUID.fromString("ffffffff-ffff-4fff-8fff-ffffffffffff");
    private static final DemoUser USER=new DemoUser("reader","unused",ORG,PROJECT,ID,"viewer");
    private ReceiptHistoryCursor cursor(UUID campaign){return new ReceiptHistoryCursor(ORG,PROJECT,campaign,Instant.parse("2026-10-11T05:00:00.123456Z"),ID);}
    @Test void microsecondsCampaignAndAllHistoryRemainDistinct(){for(UUID campaign:new UUID[]{null,CAMPAIGN,new UUID(0,0)}){var original=cursor(campaign);assertEquals(107,original.encode().length());assertEquals(original,ReceiptHistoryCursor.decode(original.encode(),USER,campaign));}}
    @Test void foreignScopeAndChangedCampaignCannotReuseBoundary(){
        assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(cursor(CAMPAIGN).encode(),new DemoUser("foreign","unused",UUID.randomUUID(),PROJECT,ID,"admin"),CAMPAIGN));
        assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(cursor(CAMPAIGN).encode(),new DemoUser("foreign-project","unused",ORG,UUID.randomUUID(),ID,"admin"),CAMPAIGN));
        for(UUID campaign:new UUID[]{null,UUID.randomUUID()})assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(cursor(CAMPAIGN).encode(),USER,campaign));
        assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(cursor(null).encode(),USER,CAMPAIGN));
    }
    @Test void wrongDomainNoncanonicalEncodingAndImpossibleTimestampAreRejected(){
        String token=cursor(CAMPAIGN).encode();for(String invalid:new String[]{"",token+"=",token.substring(1),token+"/../../runs"})assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(invalid,USER,CAMPAIGN));
        for(int offset:new int[]{0,35,52}){var bytes=Base64.getUrlDecoder().decode(token);bytes[offset]=(byte)255;assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),USER,CAMPAIGN));}
        for(int nanos:new int[]{-1,1,1_000_000_000}){var bytes=Base64.getUrlDecoder().decode(token);ByteBuffer.wrap(bytes).putInt(60,nanos);assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),USER,CAMPAIGN));}
        for(long seconds:new long[]{-1,Long.MAX_VALUE}){var bytes=Base64.getUrlDecoder().decode(token);ByteBuffer.wrap(bytes).putLong(52,seconds);assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),USER,CAMPAIGN));}
        String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",noncanonical=token.substring(0,106)+alphabet.charAt(alphabet.indexOf(token.charAt(106))+1);assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(noncanonical,USER,CAMPAIGN));
        var bytes=Base64.getUrlDecoder().decode(token);bytes[35]=0;assertThrows(IllegalArgumentException.class,()->ReceiptHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),USER,null));
    }
}
