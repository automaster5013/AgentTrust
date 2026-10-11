package dev.agenttrust.core;

import java.sql.Timestamp;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Immutable admission parameters; current release permission still belongs to OPA. */
final class CampaignReleaseRequirements {
    static String requestHash(UUID agent,UUID dataset,boolean approval,UUID baseline,Integer maxAge) {
        parameters(baseline,maxAge);
        return ArchiveIntegrity.sha256(("campaign/v1\n"+agent+"\n"+dataset+"\n"+approval+(baseline==null?"":"\nrelease-baseline/v1\n"+baseline+"\n"+maxAge)).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    static void parameters(UUID baseline,Integer maxAge) {
        if((baseline==null)!=(maxAge==null)||maxAge!=null&&(maxAge<60||maxAge>86400))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    }
    static void compatible(Map<String,Object> candidate,Map<String,Object> baseline) {
        var a=(Map<?,?>)candidate.get("agentVersion");var b=(Map<?,?>)baseline.get("agentVersion");
        if(!candidate.get("dataset_version_id").equals(baseline.get("dataset_version_id"))
            ||!candidate.get("dataset_content_sha256").equals(baseline.get("dataset_content_sha256"))
            ||!a.get("resource_key").equals(b.get("resource_key")))
            throw new ResponseStatusException(HttpStatus.CONFLICT);
    }
    static long createdAt(Map<String,Object> record) {
        if(!(record.get("created_at") instanceof Timestamp time)||time.getTime()<1)
            throw new IllegalArgumentException("Campaign evidence time unavailable");
        return time.getTime();
    }
    static long expiresAt(long createdAt,int maxAge) {
        parameters(new UUID(0,1),maxAge);
        if(createdAt<1||createdAt>9_007_199_254_740_991L-maxAge*1000L)
            throw new IllegalArgumentException("Invalid campaign evidence time");
        return createdAt+maxAge*1000L;
    }
    static boolean current(long now,long candidateCreated,long baselineCreated,int maxAge) {
        return now>=candidateCreated&&now>=baselineCreated
            &&now<expiresAt(candidateCreated,maxAge)&&now<expiresAt(baselineCreated,maxAge);
    }
}
