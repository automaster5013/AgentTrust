package dev.agenttrust.core;

import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

/** A navigation boundary, never a credential or proof of complete history. */
record AuditCursor(UUID organizationId, UUID projectId, Instant createdAt, UUID id) {
    String encode() {
        var bytes=ByteBuffer.allocate(60);
        put(bytes,organizationId);put(bytes,projectId);
        bytes.putLong(createdAt.getEpochSecond()).putInt(createdAt.getNano());put(bytes,id);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.array());
    }
    static AuditCursor decode(String token,DemoUser user) {
        if(token==null||!token.matches("[A-Za-z0-9_-]{80}"))throw new IllegalArgumentException("Invalid audit boundary");
        var bytes=ByteBuffer.wrap(Base64.getUrlDecoder().decode(token));
        UUID organization=get(bytes),project=get(bytes);long seconds=bytes.getLong();int nanos=bytes.getInt();UUID id=get(bytes);
        if(!organization.equals(user.organizationId())||!project.equals(user.projectId())||seconds<0||seconds>253402300799L||nanos<0||nanos>=1_000_000_000||nanos%1000!=0)throw new IllegalArgumentException("Invalid audit boundary");
        var cursor=new AuditCursor(organization,project,Instant.ofEpochSecond(seconds,nanos),id);
        if(!cursor.encode().equals(token))throw new IllegalArgumentException("Invalid audit encoding");
        return cursor;
    }
    private static void put(ByteBuffer bytes,UUID value){bytes.putLong(value.getMostSignificantBits()).putLong(value.getLeastSignificantBits());}
    private static UUID get(ByteBuffer bytes){return new UUID(bytes.getLong(),bytes.getLong());}
}
