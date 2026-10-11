package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

/** Read-only navigation bound to registry kind and authenticated tenant. */
record VersionHistoryCursor(String kind,UUID organizationId,UUID projectId,Instant createdAt,UUID id){
    String encode(){var bytes=ByteBuffer.allocate(63);bytes.put(domain(kind));put(bytes,organizationId);put(bytes,projectId);bytes.putLong(createdAt.getEpochSecond()).putInt(createdAt.getNano());put(bytes,id);return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.array());}
    static VersionHistoryCursor decode(String token,DemoUser user,String kind){
        if(token==null||!token.matches("[A-Za-z0-9_-]{84}"))throw new IllegalArgumentException("Invalid version boundary");
        var bytes=ByteBuffer.wrap(Base64.getUrlDecoder().decode(token));var expected=domain(kind);if(bytes.get()!=expected[0]||bytes.get()!=expected[1]||bytes.get()!=expected[2])throw new IllegalArgumentException("Invalid boundary domain");
        UUID org=get(bytes),project=get(bytes);long seconds=bytes.getLong();int nanos=bytes.getInt();UUID id=get(bytes);
        if(!org.equals(user.organizationId())||!project.equals(user.projectId())||seconds<0||seconds>253402300799L||nanos<0||nanos>=1_000_000_000||nanos%1000!=0)throw new IllegalArgumentException("Invalid version boundary");
        var cursor=new VersionHistoryCursor(kind,org,project,Instant.ofEpochSecond(seconds,nanos),id);if(!cursor.encode().equals(token))throw new IllegalArgumentException("Invalid version encoding");return cursor;
    }
    private static byte[] domain(String kind){return switch(kind){case "agents"->new byte[]{'A','G','S'};case "datasets"->new byte[]{'D','T','S'};default->throw new IllegalArgumentException("Invalid registry kind");};}
    private static void put(ByteBuffer bytes,UUID id){bytes.putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits());}
    private static UUID get(ByteBuffer bytes){return new UUID(bytes.getLong(),bytes.getLong());}
}
