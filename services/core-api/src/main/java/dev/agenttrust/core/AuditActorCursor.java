package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;

/** Separate actor search boundary preserves the legacy action/resource cursor contract. */
final class AuditActorCursor {
 private AuditActorCursor(){}
 static UUID actor(String value){try{UUID id=UUID.fromString(value);if(!id.toString().equals(value))throw new IllegalArgumentException();return id;}catch(RuntimeException invalid){throw new IllegalArgumentException("Invalid audit actor");}}
 private static byte[] digest(UUID actor){try{return MessageDigest.getInstance("SHA-256").digest(("audit-actor="+actor).getBytes(StandardCharsets.US_ASCII));}catch(java.security.NoSuchAlgorithmException unavailable){throw new IllegalStateException(unavailable);}}
 static String encode(AuditCursor boundary,AuditFilters filters,UUID actor){return Base64.getUrlEncoder().withoutPadding().encodeToString(ByteBuffer.allocate(126).put((byte)1).put(digest(actor)).put(Base64.getUrlDecoder().decode(AuditSearchCursor.encode(boundary,filters))).array());}
 static AuditCursor decode(String token,DemoUser user,AuditFilters filters,UUID actor){
  if(token==null||!token.matches("[A-Za-z0-9_-]{168}"))throw new IllegalArgumentException("Invalid audit actor boundary");
  byte[] raw=Base64.getUrlDecoder().decode(token);
  if(raw.length!=126||raw[0]!=1||!MessageDigest.isEqual(Arrays.copyOfRange(raw,1,33),digest(actor))||!Base64.getUrlEncoder().withoutPadding().encodeToString(raw).equals(token))throw new IllegalArgumentException("Invalid audit actor binding");
  return AuditSearchCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOfRange(raw,33,126)),user,filters);
 }
}
