package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class CampaignArchivesTest {
    private final ObjectMapper mapper=new ObjectMapper();
    @Test void storedParentMustBindTheExactCampaignAndChildArchiveVersions(){
        var parent=mapper.valueToTree(Map.of("id",UUID.randomUUID(),"agent_content_sha256","a".repeat(64)));
        var children=mapper.valueToTree(List.of(Map.of("runId",UUID.randomUUID(),"storageVersion","version-1","contentSha256","b".repeat(64))));
        var doc=mapper.valueToTree(Map.of("schemaVersion",2,"kind","campaign-evidence","deploymentAuthority",false,"campaign",parent,"childArchives",children));
        assertDoesNotThrow(()->CampaignArchives.validate(doc,parent,children));
        assertThrows(IllegalArgumentException.class,()->CampaignArchives.validate(doc,mapper.valueToTree(Map.of("id",UUID.randomUUID())),children));
        assertThrows(IllegalArgumentException.class,()->CampaignArchives.validate(doc,parent,mapper.valueToTree(List.of(Map.of("storageVersion","version-2")))));
    }
    @Test void historicalEvidenceCannotIntroduceDeploymentAuthorityOrUnsupportedSchema(){
        var parent=mapper.createObjectNode();var children=mapper.createArrayNode();
        for(var value:List.of(Map.of("schemaVersion",2,"kind","campaign-evidence","deploymentAuthority",true,"campaign",parent,"childArchives",children),Map.of("schemaVersion","2","kind","campaign-evidence","deploymentAuthority",false,"campaign",parent,"childArchives",children),Map.of("schemaVersion",2,"kind","unknown","deploymentAuthority",false,"campaign",parent,"childArchives",children)))assertThrows(IllegalArgumentException.class,()->CampaignArchives.validate(mapper.valueToTree(value),parent,children));
    }
    @Test void snapshotsNormalizeJdbcTimestampsWithoutMutatingTheSource(){
        var time=Timestamp.from(java.time.Instant.parse("2026-10-11T00:00:00.123456Z"));var original=Map.of("created_at",time,"version",Map.of("created_at",time));var normalized=(Map<?,?>)CampaignArchives.normalized(original);
        assertEquals("2026-10-11T00:00:00.123456Z",normalized.get("created_at"));assertSame(time,original.get("created_at"));assertEquals(normalized.get("created_at"),((Map<?,?>)normalized.get("version")).get("created_at"));
    }
    @Test void campaignObjectsUseTheirOwnScopedNamespace(){
        UUID org=UUID.randomUUID(),project=UUID.randomUUID(),id=UUID.randomUUID();String hash="a".repeat(64);
        assertTrue(ArchiveIntegrity.campaignKey(org,project,id,hash).contains("/campaigns/"+id+"/"));assertNotEquals(ArchiveIntegrity.key(org,project,id,hash),ArchiveIntegrity.campaignKey(org,project,id,hash));assertThrows(IllegalArgumentException.class,()->ArchiveIntegrity.campaignKey(org,project,id,"bad"));
    }
}
