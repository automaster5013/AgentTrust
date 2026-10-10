package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** A frozen evaluation snapshot binds version contents to exact child archive versions.
 * Current review and deployment permission are deliberately outside this historical evidence. */
@Service
@ConditionalOnProperty(name="agenttrust.object-mode",havingValue="minio")
public class CampaignArchives {
    private final RunService runs;
    private final CampaignService campaigns;
    private final EvidenceArchives children;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final MinioArchiveClient storage;
    private final List<DemoUser> scopes;

    public CampaignArchives(RunService runs,CampaignService campaigns,EvidenceArchives children,JdbcTemplate jdbc,ObjectMapper mapper,MinioArchiveClient storage,@Value("${agenttrust.demo-credentials-file}") String file) throws Exception {
        this.runs=runs;this.campaigns=campaigns;this.children=children;this.jdbc=jdbc;this.mapper=mapper;this.storage=storage;
        var seen=new HashSet<String>();var values=new ArrayList<DemoUser>();
        for(var row:mapper.readTree(Files.readString(Path.of(file)))){
            UUID org=UUID.fromString(row.path("organizationId").asText()),project=UUID.fromString(row.path("projectId").asText());
            if(seen.add(org+"/"+project))values.add(new DemoUser("campaign-archiver","unused",org,project,UUID.fromString(row.path("actorId").asText()),"viewer"));
        }
        scopes=List.copyOf(values);
    }

    @Scheduled(fixedDelay=3000,initialDelay=5000)
    void archivePending(){
        for(var scope:scopes){
            try{
                var pending=runs.scoped(scope,()->jdbc.queryForList("SELECT p.id FROM stack_campaigns p LEFT JOIN stack_campaign_archives a ON a.campaign_id=p.id WHERE p.organization_id=? AND p.project_id=? AND a.campaign_id IS NULL ORDER BY p.created_at,p.id LIMIT 10",scope.organizationId(),scope.projectId()));
                for(var row:pending){try{archive(scope,(UUID)row.get("id"));}catch(Exception unavailable){/* Retry eligible immutable evaluations without logging their contents. */}}
            }catch(Exception unavailable){/* Database or storage interruption must not produce a false archive proof. */}
        }
    }

    static Object normalized(Object value){
        if(value instanceof java.sql.Timestamp timestamp)return timestamp.toInstant().toString();
        if(value instanceof java.time.OffsetDateTime timestamp)return timestamp.toInstant().toString();
        if(value instanceof Map<?,?> map){var result=new TreeMap<String,Object>();for(var entry:map.entrySet())result.put((String)entry.getKey(),normalized(entry.getValue()));return result;}
        if(value instanceof List<?> list)return list.stream().map(CampaignArchives::normalized).toList();
        return value;
    }

    private List<Map<String,Object>> descriptors(DemoUser user,UUID id){
        var values=new ArrayList<Map<String,Object>>();
        for(var item:campaigns.cases(user,id))values.add(children.descriptor(user,item.runId()));
        return List.copyOf(values);
    }

    private List<Map<String,Object>> metadata(DemoUser user,UUID id){return jdbc.queryForList("SELECT content_sha256,object_key,version_id,content_bytes FROM stack_campaign_archives WHERE campaign_id=? AND organization_id=? AND project_id=?",id,user.organizationId(),user.projectId());}

    void archive(DemoUser user,UUID id){runs.scoped(user,()->{
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign-archive/"+id);
        if(!metadata(user,id).isEmpty())return null;
        var campaign=campaigns.get(user,id);if(campaign.get("state").equals("queued"))return null;
        var references=descriptors(user,id);
        // Before creating a parent proof, read each original child object's pinned version.
        for(var reference:references){
            var proof=children.evidence(user,(UUID)reference.get("runId"));
            if(!proof.get("contentSha256").equals(reference.get("contentSha256"))||!proof.get("storageVersion").equals(reference.get("storageVersion")))throw new IllegalStateException("Child archive binding unavailable");
        }
        try{
            var document=Map.of("schemaVersion",2,"kind","campaign-evidence","deploymentAuthority",false,"campaign",normalized(campaign),"childArchives",references);
            byte[] content=mapper.writeValueAsBytes(new TreeMap<>(document));String hash=ArchiveIntegrity.sha256(content),key=ArchiveIntegrity.campaignKey(user.organizationId(),user.projectId(),id,hash),version=storage.persist(key,content);
            jdbc.update("INSERT INTO stack_campaign_archives(campaign_id,organization_id,project_id,content_sha256,object_key,version_id,content_bytes) VALUES(?,?,?,?,?,?,?)",id,user.organizationId(),user.projectId(),hash,key,version,content.length);return null;
        }catch(Exception unavailable){throw new IllegalStateException("Campaign archive unavailable");}
    });}

    static void validate(JsonNode document,JsonNode expectedCampaign,JsonNode expectedChildren){
        if(!document.isObject()||document.size()!=5||!document.path("schemaVersion").isIntegralNumber()||document.path("schemaVersion").asInt()!=2||!document.path("kind").asText().equals("campaign-evidence")||!document.path("deploymentAuthority").isBoolean()||document.path("deploymentAuthority").asBoolean()||!document.path("campaign").equals(expectedCampaign)||!document.path("childArchives").equals(expectedChildren))throw new IllegalArgumentException("Campaign archive binding mismatch");
    }

    public Map<String,Object> evidence(DemoUser user,UUID id){
        var expected=runs.scoped(user,()->{
            var campaign=campaigns.get(user,id);var rows=metadata(user,id);if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.CONFLICT);
            return Map.of("metadata",rows.getFirst(),"campaign",normalized(campaign),"children",descriptors(user,id));
        });
        var descriptor=(Map<?,?>)expected.get("metadata");String hash=(String)descriptor.get("content_sha256"),key=(String)descriptor.get("object_key"),version=(String)descriptor.get("version_id");
        if(!key.equals(ArchiveIntegrity.campaignKey(user.organizationId(),user.projectId(),id,hash)))throw new ResponseStatusException(HttpStatus.BAD_GATEWAY);
        try{
            var stored=storage.read(key,version);ArchiveIntegrity.verify(stored.content(),hash,(Integer)descriptor.get("content_bytes"));
            validate(mapper.readTree(stored.content()),mapper.valueToTree(expected.get("campaign")),mapper.valueToTree(expected.get("children")));
            return Map.of("campaignId",id,"organizationId",user.organizationId(),"projectId",user.projectId(),"contentSha256",hash,"contentBytes",stored.content().length,"storageVersion",version,"integrityVerified",true,"storageEngine","minio","contentBase64",Base64.getEncoder().encodeToString(stored.content()));
        }catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_GATEWAY);}catch(Exception unavailable){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);}
    }
}
