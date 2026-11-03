package dev.agenttrust.core;
import java.nio.ByteBuffer;import java.security.MessageDigest;import java.util.Arrays;import java.util.Base64;
final class AuditPeriodCursor {
 private AuditPeriodCursor(){}
 static String encode(AuditCursor boundary,AuditPeriod period){return Base64.getUrlEncoder().withoutPadding().encodeToString(ByteBuffer.allocate(93).put((byte)2).put(period.digest()).put(Base64.getUrlDecoder().decode(boundary.encode())).array());}
 static AuditCursor decode(String token,DemoUser user,AuditPeriod period){
  if(token==null||!token.matches("[A-Za-z0-9_-]{124}"))throw new IllegalArgumentException("Invalid audit period boundary");byte[] raw=Base64.getUrlDecoder().decode(token);
  if(raw.length!=93||raw[0]!=2||!MessageDigest.isEqual(Arrays.copyOfRange(raw,1,33),period.digest())||!Base64.getUrlEncoder().withoutPadding().encodeToString(raw).equals(token))throw new IllegalArgumentException("Invalid audit period binding");
  var cursor=AuditCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOfRange(raw,33,93)),user);
  if(cursor.createdAt().isBefore(period.startInclusive())||!cursor.createdAt().isBefore(period.endExclusive()))throw new IllegalArgumentException("Audit boundary outside period");return cursor;
 }
}
