package dev.agenttrust.core;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.Base64;
import java.util.Objects;
import java.util.UUID;

/** Scoped navigation boundary, including the selected dataset; never release authority. */
record CampaignHistoryCursor(UUID organizationId,UUID projectId,UUID datasetVersionId,Instant createdAt,UUID id){
    private static final UUID ZERO=new UUID(0,0);
    String encode(){var bytes=ByteBuffer.allocate(80);bytes.put(new byte[]{'C','M','P'});put(bytes,organizationId);put(bytes,projectId);bytes.put((byte)(datasetVersionId==null?0:1));put(bytes,datasetVersionId==null?ZERO:datasetVersionId);bytes.putLong(createdAt.getEpochSecond()).putInt(createdAt.getNano());put(bytes,id);return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.array());}
    static CampaignHistoryCursor decode(String token,DemoUser user,UUID dataset){
        if(token==null||!token.matches("[A-Za-z0-9_-]{107}"))throw new IllegalArgumentException("Invalid campaign boundary");
        var bytes=ByteBuffer.wrap(Base64.getUrlDecoder().decode(token));if(bytes.remaining()!=80||bytes.get()!='C'||bytes.get()!='M'||bytes.get()!='P')throw new IllegalArgumentException("Invalid boundary domain");
        UUID org=get(bytes),project=get(bytes);byte filtered=bytes.get();UUID storedDataset=get(bytes);
        if(filtered<0||filtered>1||filtered==0&&!storedDataset.equals(ZERO))throw new IllegalArgumentException("Invalid dataset boundary");
        UUID boundDataset=filtered==0?null:storedDataset;long seconds=bytes.getLong();int nanos=bytes.getInt();UUID id=get(bytes);
        if(!org.equals(user.organizationId())||!project.equals(user.projectId())||!Objects.equals(boundDataset,dataset)||seconds<0||seconds>253402300799L||nanos<0||nanos>=1_000_000_000||nanos%1000!=0)throw new IllegalArgumentException("Invalid campaign boundary");
        var cursor=new CampaignHistoryCursor(org,project,boundDataset,Instant.ofEpochSecond(seconds,nanos),id);if(!cursor.encode().equals(token))throw new IllegalArgumentException("Invalid campaign encoding");return cursor;
    }
    private static void put(ByteBuffer bytes,UUID id){bytes.putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits());}
    private static UUID get(ByteBuffer bytes){return new UUID(bytes.getLong(),bytes.getLong());}
}
