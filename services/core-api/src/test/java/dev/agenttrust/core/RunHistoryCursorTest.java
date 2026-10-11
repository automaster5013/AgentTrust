package dev.agenttrust.core;
import java.time.Instant;
import java.util.UUID;
import java.nio.ByteBuffer;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class RunHistoryCursorTest {
    private static final UUID ORG=UUID.fromString("11111111-1111-4111-8111-111111111111"),PROJECT=UUID.fromString("22222222-2222-4222-8222-222222222222"),ID=UUID.fromString("ffffffff-ffff-4fff-8fff-ffffffffffff");
    private static final DemoUser USER=new DemoUser("reader","unused",ORG,PROJECT,ID,"viewer");
    @Test void exactMicrosecondsAndUnsignedUuidBytesSurviveNavigation(){
        var original=new RunHistoryCursor(ORG,PROJECT,Instant.parse("2026-10-11T05:00:00.123456Z"),ID);
        assertEquals(84,original.encode().length());assertEquals(original,RunHistoryCursor.decode(original.encode(),USER));
    }
    @Test void foreignScopeCannotReuseAValidBoundary(){
        var cursor=new RunHistoryCursor(ORG,PROJECT,Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),ID).encode();
        for(var reader:new DemoUser[]{new DemoUser("foreign","unused",UUID.randomUUID(),PROJECT,ID,"admin"),new DemoUser("foreign-project","unused",ORG,UUID.randomUUID(),ID,"admin")})assertThrows(IllegalArgumentException.class,()->RunHistoryCursor.decode(cursor,reader));
    }
    @Test void malformedLengthPaddingAndImpossibleTimestampsAreRejected(){
        String token=new RunHistoryCursor(ORG,PROJECT,Instant.parse("2026-10-11T05:00:00Z"),ID).encode();
        for(String invalid:new String[]{"",token+"=",token.substring(1),"!"+token.substring(1),token+"/../../runs"})assertThrows(IllegalArgumentException.class,()->RunHistoryCursor.decode(invalid,USER));
        for(int nanos:new int[]{-1,1,1_000_000_000}){var bytes=Base64.getUrlDecoder().decode(token);ByteBuffer.wrap(bytes).putInt(43,nanos);String invalid=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);assertThrows(IllegalArgumentException.class,()->RunHistoryCursor.decode(invalid,USER));}
        for(long seconds:new long[]{-1,Long.MAX_VALUE}){var bytes=Base64.getUrlDecoder().decode(token);ByteBuffer.wrap(bytes).putLong(35,seconds);String invalid=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);assertThrows(IllegalArgumentException.class,()->RunHistoryCursor.decode(invalid,USER));}
    }
}
