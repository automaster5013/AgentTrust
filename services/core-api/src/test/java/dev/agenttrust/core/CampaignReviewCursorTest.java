package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class CampaignReviewCursorTest {
 private final UUID org=UUID.randomUUID(),project=UUID.randomUUID(),campaign=UUID.randomUUID(),actor=UUID.randomUUID();
 private final DemoUser user=new DemoUser("reader","unused",org,project,actor,"viewer");
 @Test void safeSequenceAndScopedBoundaryRoundTrip(){for(long sequence:new long[]{1,50,CampaignReviewCursor.MAX_SEQUENCE}){var cursor=new CampaignReviewCursor(org,project,campaign,sequence);assertEquals(79,cursor.encode().length());assertEquals(cursor,CampaignReviewCursor.decode(cursor.encode(),user,campaign));}}
 @Test void scopeAndCampaignSubstitutionFailClosed(){String token=new CampaignReviewCursor(org,project,campaign,50).encode();assertThrows(IllegalArgumentException.class,()->CampaignReviewCursor.decode(token,user,UUID.randomUUID()));for(DemoUser other:new DemoUser[]{new DemoUser("other","unused",UUID.randomUUID(),project,actor,"admin"),new DemoUser("other","unused",org,UUID.randomUUID(),actor,"viewer")})assertThrows(IllegalArgumentException.class,()->CampaignReviewCursor.decode(token,other,campaign));}
 @Test void malformedDomainUnsafeSequenceAndNoncanonicalEncodingFailClosed(){String token=new CampaignReviewCursor(org,project,campaign,50).encode();for(String invalid:new String[]{"",token+"=",token.substring(1),token+"/../"})assertThrows(IllegalArgumentException.class,()->CampaignReviewCursor.decode(invalid,user,campaign));for(long sequence:new long[]{0,-1,CampaignReviewCursor.MAX_SEQUENCE+1,Long.MAX_VALUE})assertThrows(IllegalArgumentException.class,()->CampaignReviewCursor.decode(new CampaignReviewCursor(org,project,campaign,sequence).encode(),user,campaign));var bytes=Base64.getUrlDecoder().decode(token);bytes[0]='X';assertThrows(IllegalArgumentException.class,()->CampaignReviewCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),user,campaign));String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";String alias=token.substring(0,78)+alphabet.charAt(alphabet.indexOf(token.charAt(78))+1);assertThrows(IllegalArgumentException.class,()->CampaignReviewCursor.decode(alias,user,campaign));}
}
