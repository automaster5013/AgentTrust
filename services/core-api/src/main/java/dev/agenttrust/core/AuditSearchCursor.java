package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;

/** Binds navigation to its tenant and exact search; it grants no authority. */
final class AuditSearchCursor {
 private AuditSearchCursor(){}
 static String encode(AuditCursor boundary,AuditFilters filters){return Base64.getUrlEncoder().withoutPadding().encodeToString(ByteBuffer.allocate(93).put((byte)1).put(filters.digest()).put(Base64.getUrlDecoder().decode(boundary.encode())).array());}
 static AuditCursor decode(String token,DemoUser user,AuditFilters filters){
  if(token==null||!token.matches("[A-Za-z0-9_-]{124}"))throw new IllegalArgumentException("Invalid audit search boundary");
  byte[] raw=Base64.getUrlDecoder().decode(token);
  if(raw.length!=93||raw[0]!=1||!MessageDigest.isEqual(Arrays.copyOfRange(raw,1,33),filters.digest())||!Base64.getUrlEncoder().withoutPadding().encodeToString(raw).equals(token))throw new IllegalArgumentException("Invalid audit search binding");
  return AuditCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOfRange(raw,33,93)),user);
 }
}
