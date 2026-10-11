package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Short-lived, challenge-bound development checks. This is not a deployment capability. */
@Service
@ConditionalOnProperty(name="agenttrust.gate-signing-mode",havingValue="local-development")
public class CampaignGateChecks {
    static final long MAX_AGE_MILLIS=30_000L;
    private final RunService runs;
    private final CampaignService campaigns;
    private final CampaignArchives archives;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final GateSigner signer;

    public CampaignGateChecks(RunService runs,CampaignService campaigns,CampaignArchives archives,JdbcTemplate jdbc,ObjectMapper mapper,GateSigner signer) {
        this.runs=runs;this.campaigns=campaigns;this.archives=archives;this.jdbc=jdbc;this.mapper=mapper;this.signer=signer;
    }

    static void challenge(String value) {
        if(value==null||!value.matches("[a-f0-9]{64}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    }

    static long expiry(long checkedAt,Evaluation.Gate gate,Map<String,Object> review) {
        if(checkedAt<1||checkedAt>9_007_199_254_710_991L)throw new IllegalArgumentException("Invalid check time");
        long expires=checkedAt+MAX_AGE_MILLIS;
        if(gate.deploymentAllowed()&&gate.currentReviewRequired()) {
            if(review==null||!"approved".equals(review.get("decision"))||!(review.get("created_at") instanceof Timestamp created))throw new IllegalArgumentException("Approval time unavailable");
            long reviewedAt=created.getTime();
            if(reviewedAt<1||reviewedAt>checkedAt||checkedAt-reviewedAt>=PolicyClient.APPROVAL_TTL_MILLIS)throw new IllegalArgumentException("Approval expired");
            expires=Math.min(expires,reviewedAt+PolicyClient.APPROVAL_TTL_MILLIS);
        }
        return expires;
    }

    public Map<String,Object> check(DemoUser user,UUID campaign,String nonce) {
        challenge(nonce);
        return runs.scoped(user,()->{
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign-review/"+campaign);
            var record=campaigns.get(user,campaign);
            if("queued".equals(record.get("state")))throw new ResponseStatusException(HttpStatus.CONFLICT);
            var evidence=archives.evidence(user,campaign);
            long checkedAt=System.currentTimeMillis();
            var gate=campaigns.gate(user,campaign);
            if(!"evaluated".equals(gate.policyStatus()))throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            var review=campaigns.latestReview(user,campaign);
            try {
                long expiresAt=expiry(checkedAt,gate,review);
                var payload=new TreeMap<String,Object>();
                payload.put("schemaVersion",1);payload.put("kind","campaign-current-gate-check");payload.put("trustDomain",GateSigner.TRUST_DOMAIN);
                payload.put("currentDeploymentAuthority",false);payload.put("challenge",nonce);payload.put("campaignId",campaign);
                payload.put("organizationId",user.organizationId());payload.put("projectId",user.projectId());payload.put("actorId",user.actorId());
                payload.put("checkedAtEpochMillis",checkedAt);payload.put("expiresAtEpochMillis",expiresAt);
                payload.put("agentVersionId",record.get("agent_version_id"));payload.put("datasetVersionId",record.get("dataset_version_id"));
                payload.put("agentContentSha256",record.get("agent_content_sha256"));payload.put("datasetContentSha256",record.get("dataset_content_sha256"));
                payload.put("evaluationState",record.get("state"));payload.put("evaluationDecision",record.get("decision"));payload.put("observedGate",gate);
                payload.put("latestReview",review==null?null:Map.of("id",review.get("id"),"decision",review.get("decision"),"sequence",review.get("review_sequence"),"policyVersion",review.get("policy_version"),"policyDigest",review.get("policy_digest"),"createdAtEpochMillis",((Timestamp)review.get("created_at")).getTime()));
                payload.put("campaignArchive",Map.of("contentSha256",evidence.get("contentSha256"),"contentBytes",evidence.get("contentBytes"),"storageVersion",evidence.get("storageVersion")));
                byte[] bytes=mapper.writeValueAsBytes(payload);
                var result=new HashMap<String,Object>();result.put("payloadBase64",Base64.getEncoder().encodeToString(bytes));result.put("payloadSha256",ArchiveIntegrity.sha256(bytes));result.put("payloadBytes",bytes.length);
                result.put("signatureBase64",signer.sign(bytes));result.put("keyId",signer.keyId());result.put("signatureAlgorithm","Ed25519");result.put("trustDomain",GateSigner.TRUST_DOMAIN);result.put("currentDeploymentAuthority",false);
                if(System.currentTimeMillis()>=expiresAt)throw new IllegalArgumentException("Check expired before issuance");
                return result;
            }catch(Exception unavailable){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);}
        });
    }
}
