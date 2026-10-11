package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

/** Read-only navigation, domain separated from audit cursors; never an authority token. */
record RunHistoryCursor(UUID organizationId,UUID projectId,Instant createdAt,UUID id){
    String encode(){var bytes=ByteBuffer.allocate(63);bytes.put(new byte[]{'R','U','N'});put(bytes,organizationId);put(bytes,projectId);bytes.putLong(createdAt.getEpochSecond()).putInt(createdAt.getNano());put(bytes,id);return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.array());}
    static RunHistoryCursor decode(String token,DemoUser user){
        if(token==null||!token.matches("[A-Za-z0-9_-]{84}"))throw new IllegalArgumentException("Invalid run boundary");
        var bytes=ByteBuffer.wrap(Base64.getUrlDecoder().decode(token));if(bytes.get()!='R'||bytes.get()!='U'||bytes.get()!='N')throw new IllegalArgumentException("Invalid boundary domain");
        UUID org=get(bytes),project=get(bytes);long seconds=bytes.getLong();int nanos=bytes.getInt();UUID id=get(bytes);
        if(!org.equals(user.organizationId())||!project.equals(user.projectId())||seconds<0||seconds>253402300799L||nanos<0||nanos>=1_000_000_000||nanos%1000!=0)throw new IllegalArgumentException("Invalid run boundary");
        var cursor=new RunHistoryCursor(org,project,Instant.ofEpochSecond(seconds,nanos),id);if(!cursor.encode().equals(token))throw new IllegalArgumentException("Invalid run encoding");return cursor;
    }
    private static void put(ByteBuffer bytes,UUID id){bytes.putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits());}
    private static UUID get(ByteBuffer bytes){return new UUID(bytes.getLong(),bytes.getLong());}
}
