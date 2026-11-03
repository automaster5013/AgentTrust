package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;

/** Exact resource name and tenant/kind bound navigation; no deployment authority. */
final class VersionHistorySearchCursor {
 private VersionHistorySearchCursor(){}
 static String key(String value){if(value==null||!value.matches("[a-z][a-z0-9-]{2,63}"))throw new IllegalArgumentException("Invalid resource name");return value;}
 private static byte[] digest(String name){try{return MessageDigest.getInstance("SHA-256").digest(("version-resource-key="+key(name)).getBytes(StandardCharsets.UTF_8));}catch(java.security.NoSuchAlgorithmException error){throw new IllegalStateException(error);}}
 static String encode(VersionHistoryCursor boundary,String name){return Base64.getUrlEncoder().withoutPadding().encodeToString(ByteBuffer.allocate(96).put((byte)1).put(digest(name)).put(Base64.getUrlDecoder().decode(boundary.encode())).array());}
 static VersionHistoryCursor decode(String token,DemoUser user,String kind,String name){
  if(token==null||!token.matches("[A-Za-z0-9_-]{128}"))throw new IllegalArgumentException("Invalid version search boundary");
  byte[] raw=Base64.getUrlDecoder().decode(token);
  if(raw.length!=96||raw[0]!=1||!MessageDigest.isEqual(Arrays.copyOfRange(raw,1,33),digest(name))||!Base64.getUrlEncoder().withoutPadding().encodeToString(raw).equals(token))throw new IllegalArgumentException("Invalid version search binding");
  return VersionHistoryCursor.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOfRange(raw,33,96)),user,kind);
 }
}
