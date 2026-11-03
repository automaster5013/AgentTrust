package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;

/** Exact filters plus the existing tenant/microsecond boundary; no release authority. */
final class RunHistorySearchCursor {
    private RunHistorySearchCursor(){}
    static String encode(RunHistoryCursor boundary,RunHistoryFilters filters){return Base64.getUrlEncoder().withoutPadding().encodeToString(ByteBuffer.allocate(96).put((byte)1).put(filters.digest()).put(Base64.getUrlDecoder().decode(boundary.encode())).array());}
    static RunHistoryCursor decode(String token,DemoUser user,RunHistoryFilters filters){
        if(token==null||!token.matches("[A-Za-z0-9_-]{128}"))throw new IllegalArgumentException("Invalid run search boundary");
        byte[] raw=Base64.getUrlDecoder().decode(token);
        if(raw.length!=96||raw[0]!=1||!MessageDigest.isEqual(Arrays.copyOfRange(raw,1,33),filters.digest())||!Base64.getUrlEncoder().withoutPadding().encodeToString(raw).equals(token))throw new IllegalArgumentException("Invalid run search binding");
        return RunHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOfRange(raw,33,96)),user);
    }
}
