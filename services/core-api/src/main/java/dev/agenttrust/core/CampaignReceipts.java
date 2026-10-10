package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
@ConditionalOnProperty(name="agenttrust.gate-signing-mode",havingValue="local-development")
public class CampaignReceipts {
    private final RunService runs;private final CampaignService campaigns;private final CampaignArchives archives;private final JdbcTemplate jdbc;private final ObjectMapper mapper;private final GateSigner signer;
    public CampaignReceipts(RunService runs,CampaignService campaigns,CampaignArchives archives,JdbcTemplate jdbc,ObjectMapper mapper,GateSigner signer){this.runs=runs;this.campaigns=campaigns;this.archives=archives;this.jdbc=jdbc;this.mapper=mapper;this.signer=signer;}
    public List<Map<String,Object>> list(DemoUser user,UUID id){return runs.scoped(user,()->{campaigns.get(user,id);return jdbc.queryForList("SELECT id,key_id,created_at FROM stack_campaign_receipts WHERE campaign_id=? AND organization_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 50",id,user.organizationId(),user.projectId());});}
    public Map<String,Object> issue(DemoUser user,UUID campaign,String key,String note){
        if(!user.role().equals("admin"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}")||note==null||note.length()>200)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        String hash=ArchiveIntegrity.sha256(("receipt/v1\n"+campaign+"\n"+user.actorId()+"\n"+note).getBytes(StandardCharsets.UTF_8));
        return runs.scoped(user,()->{
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"receipt-quota/"+user.organizationId()+"/"+user.projectId());
            var previous=jdbc.queryForList("SELECT id,request_hash FROM stack_campaign_receipts WHERE campaign_id=? AND organization_id=? AND project_id=? AND idempotency_key=?",campaign,user.organizationId(),user.projectId(),key);
            if(!previous.isEmpty()){if(!hash.equals(previous.getFirst().get("request_hash")))throw new ResponseStatusException(HttpStatus.CONFLICT);return get(user,campaign,(UUID)previous.getFirst().get("id"));}
            if(jdbc.queryForObject("SELECT count(*) FROM stack_campaign_receipts WHERE organization_id=? AND project_id=?",Integer.class,user.organizationId(),user.projectId())>=200)throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS);
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign-review/"+campaign);
            var record=campaigns.get(user,campaign);if(record.get("state").equals("queued"))throw new ResponseStatusException(HttpStatus.CONFLICT);
            var proof=archives.evidence(user,campaign);var gate=campaigns.gate(user,campaign);if(!gate.policyStatus().equals("evaluated"))throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            var review=campaigns.latestReview(user,campaign);UUID id=UUID.randomUUID();String issuedAt=jdbc.queryForObject("SELECT clock_timestamp()",java.sql.Timestamp.class).toInstant().toString();
            var payload=new TreeMap<String,Object>();payload.put("schemaVersion",1);payload.put("kind","campaign-gate-observation");payload.put("trustDomain",GateSigner.TRUST_DOMAIN);payload.put("currentDeploymentAuthority",false);payload.put("receiptId",id);payload.put("campaignId",campaign);payload.put("organizationId",user.organizationId());payload.put("projectId",user.projectId());payload.put("actorId",user.actorId());payload.put("issuedAt",issuedAt);payload.put("note",note);
            payload.put("agentVersionId",record.get("agent_version_id"));payload.put("datasetVersionId",record.get("dataset_version_id"));payload.put("agentContentSha256",record.get("agent_content_sha256"));payload.put("datasetContentSha256",record.get("dataset_content_sha256"));payload.put("evaluationState",record.get("state"));payload.put("evaluationDecision",record.get("decision"));payload.put("observedGate",gate);
            payload.put("latestReview",review==null?null:Map.of("id",review.get("id"),"actorId",review.get("actor_id"),"decision",review.get("decision"),"sequence",review.get("review_sequence"),"policyVersion",review.get("policy_version"),"policyDigest",review.get("policy_digest")));
            payload.put("campaignArchive",Map.of("contentSha256",proof.get("contentSha256"),"contentBytes",proof.get("contentBytes"),"storageVersion",proof.get("storageVersion")));
            try{
                var archived=mapper.readTree(Base64.getDecoder().decode((String)proof.get("contentBase64")));payload.put("childArchives",archived.path("childArchives"));
                byte[] bytes=mapper.writeValueAsBytes(payload);String digest=ArchiveIntegrity.sha256(bytes),signature=signer.sign(bytes);
                jdbc.update("INSERT INTO stack_campaign_receipts(id,campaign_id,organization_id,project_id,actor_id,idempotency_key,request_hash,key_id,payload_base64,payload_sha256,payload_bytes,signature_base64) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",id,campaign,user.organizationId(),user.projectId(),user.actorId(),key,hash,signer.keyId(),Base64.getEncoder().encodeToString(bytes),digest,bytes.length,signature);runs.audit(user,"campaign.observation.signed",id);return get(user,campaign,id);
            }catch(Exception unavailable){throw new IllegalStateException("Signed observation unavailable");}
        });
    }
    static void binding(JsonNode payload,UUID receipt,UUID campaign,DemoUser user,UUID actor){
        if(!payload.path("schemaVersion").isIntegralNumber()||payload.path("schemaVersion").asInt()!=1||!payload.path("kind").asText().equals("campaign-gate-observation")||!payload.path("trustDomain").asText().equals(GateSigner.TRUST_DOMAIN)||!payload.path("currentDeploymentAuthority").isBoolean()||payload.path("currentDeploymentAuthority").asBoolean()||!payload.path("receiptId").asText().equals(receipt.toString())||!payload.path("campaignId").asText().equals(campaign.toString())||!payload.path("organizationId").asText().equals(user.organizationId().toString())||!payload.path("projectId").asText().equals(user.projectId().toString())||!payload.path("actorId").asText().equals(actor.toString()))throw new IllegalArgumentException("Signed observation scope mismatch");
    }
    public Map<String,Object> get(DemoUser user,UUID campaign,UUID id){return runs.scoped(user,()->{
        campaigns.get(user,campaign);var values=jdbc.queryForList("SELECT id,campaign_id,actor_id,key_id,payload_base64,payload_sha256,payload_bytes,signature_base64 FROM stack_campaign_receipts WHERE id=? AND campaign_id=? AND organization_id=? AND project_id=?",id,campaign,user.organizationId(),user.projectId());if(values.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);var row=values.getFirst();
        try{
            byte[] bytes=Base64.getDecoder().decode((String)row.get("payload_base64"));ArchiveIntegrity.verify(bytes,(String)row.get("payload_sha256"),(Integer)row.get("payload_bytes"));if(!signer.verify((String)row.get("key_id"),bytes,(String)row.get("signature_base64")))throw new IllegalArgumentException("Untrusted observation signature");binding(mapper.readTree(bytes),id,campaign,user,(UUID)row.get("actor_id"));
            var result=new HashMap<String,Object>();result.put("receiptId",id);result.put("campaignId",campaign);result.put("organizationId",user.organizationId());result.put("projectId",user.projectId());result.put("keyId",row.get("key_id"));result.put("payloadBase64",row.get("payload_base64"));result.put("payloadSha256",row.get("payload_sha256"));result.put("payloadBytes",row.get("payload_bytes"));result.put("signatureBase64",row.get("signature_base64"));result.put("signatureAlgorithm","Ed25519");result.put("trustDomain",GateSigner.TRUST_DOMAIN);result.put("signatureVerified",true);result.put("currentDeploymentAuthority",false);return result;
        }catch(Exception unavailable){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);}
    });}
}
