package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class RunReviewCursorTest {
 private final UUID org=UUID.randomUUID(),project=UUID.randomUUID(),run=UUID.randomUUID(),actor=UUID.randomUUID();
 private final DemoUser user=new DemoUser("reader","unused",org,project,actor,"viewer");
 @Test void safeSequenceAndScopedBoundaryRoundTrip(){for(long sequence:new long[]{1,50,RunReviewCursor.MAX_SEQUENCE}){var cursor=new RunReviewCursor(org,project,run,sequence);assertEquals(79,cursor.encode().length());assertEquals(cursor,RunReviewCursor.decode(cursor.encode(),user,run));}}
 @Test void scopeAndCampaignSubstitutionFailClosed(){String token=new RunReviewCursor(org,project,run,50).encode();assertThrows(IllegalArgumentException.class,()->RunReviewCursor.decode(token,user,UUID.randomUUID()));for(DemoUser other:new DemoUser[]{new DemoUser("other","unused",UUID.randomUUID(),project,actor,"admin"),new DemoUser("other","unused",org,UUID.randomUUID(),actor,"viewer")})assertThrows(IllegalArgumentException.class,()->RunReviewCursor.decode(token,other,run));}
 @Test void malformedDomainUnsafeSequenceAndNoncanonicalEncodingFailClosed(){String token=new RunReviewCursor(org,project,run,50).encode();for(String invalid:new String[]{"",token+"=",token.substring(1),token+"/../"})assertThrows(IllegalArgumentException.class,()->RunReviewCursor.decode(invalid,user,run));for(long sequence:new long[]{0,-1,RunReviewCursor.MAX_SEQUENCE+1,Long.MAX_VALUE})assertThrows(IllegalArgumentException.class,()->RunReviewCursor.decode(new RunReviewCursor(org,project,run,sequence).encode(),user,run));var bytes=Base64.getUrlDecoder().decode(token);bytes[0]='X';assertThrows(IllegalArgumentException.class,()->RunReviewCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),user,run));String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";String alias=token.substring(0,78)+alphabet.charAt(alphabet.indexOf(token.charAt(78))+1);assertThrows(IllegalArgumentException.class,()->RunReviewCursor.decode(alias,user,run));}
 @Test void campaignCursorCannotNavigateRunReviews(){String token=new CampaignReviewCursor(org,project,run,50).encode();assertThrows(IllegalArgumentException.class,()->RunReviewCursor.decode(token,user,run));String runToken=new RunReviewCursor(org,project,run,50).encode();assertThrows(IllegalArgumentException.class,()->CampaignReviewCursor.decode(runToken,user,run));}
}
