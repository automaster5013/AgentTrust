package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;

/** Navigation bound to tenant, dataset and exact search conditions; never authority. */
final class CampaignHistorySearchCursor {
    private CampaignHistorySearchCursor(){}
    static String encode(CampaignHistoryCursor boundary,CampaignHistoryFilters filters){return Base64.getUrlEncoder().withoutPadding().encodeToString(ByteBuffer.allocate(113).put((byte)1).put(filters.digest()).put(Base64.getUrlDecoder().decode(boundary.encode())).array());}
    static CampaignHistoryCursor decode(String token,DemoUser user,UUID dataset,CampaignHistoryFilters filters){
        if(token==null||!token.matches("[A-Za-z0-9_-]{151}"))throw new IllegalArgumentException("Invalid campaign search boundary");
        var raw=Base64.getUrlDecoder().decode(token);
        if(raw.length!=113||raw[0]!=1||!MessageDigest.isEqual(Arrays.copyOfRange(raw,1,33),filters.digest())||!Base64.getUrlEncoder().withoutPadding().encodeToString(raw).equals(token))throw new IllegalArgumentException("Invalid campaign search binding");
        return CampaignHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOfRange(raw,33,113)),user,dataset);
    }
}
