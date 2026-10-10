package dev.agenttrust.core;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
public final class ArchiveIntegrity {
 private ArchiveIntegrity(){}
 public static String sha256(byte[] content){if(content.length<1||content.length>16384)throw new IllegalArgumentException("Invalid evidence size");try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));}catch(java.security.NoSuchAlgorithmException error){throw new IllegalStateException("Digest unavailable");}}
 public static String key(UUID organization,UUID project,UUID run,String hash){if(!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid evidence digest");return "organizations/"+organization+"/projects/"+project+"/runs/"+run+"/"+hash+".json";}
 public static void verify(byte[] content,String expected,int size){if(content.length!=size||!MessageDigest.isEqual(sha256(content).getBytes(StandardCharsets.US_ASCII),expected.getBytes(StandardCharsets.US_ASCII)))throw new IllegalArgumentException("Evidence integrity mismatch");}
 public static void version(String version){if(version==null||!version.matches("[A-Za-z0-9._-]{1,128}")||version.equals("null"))throw new IllegalArgumentException("Missing evidence version");}
}
