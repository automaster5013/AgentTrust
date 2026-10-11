package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class CampaignReceiptsTest {
 @Test void thirdSchemaRequiresTheSignedComparisonCampaignArchiveBinding(){
  UUID receipt=UUID.randomUUID(),campaign=UUID.randomUUID(),baseline=UUID.randomUUID(),actor=UUID.randomUUID();var user=new DemoUser("reader","unused",UUID.randomUUID(),UUID.randomUUID(),actor,"viewer");var mapper=new ObjectMapper();
  var payload=new java.util.HashMap<String,Object>();payload.putAll(Map.of("schemaVersion",3,"kind","campaign-gate-observation","trustDomain",GateSigner.TRUST_DOMAIN,"currentDeploymentAuthority",false,"receiptId",receipt,"campaignId",campaign,"organizationId",user.organizationId(),"projectId",user.projectId(),"actorId",actor));payload.put("releaseRequirements",Map.of("enabled",true,"baselineCampaignId",baseline));payload.put("baselineArchives",Map.of("campaignId",baseline,"evaluationState","succeeded","evaluationDecision","pass","campaignArchive",Map.of(),"childArchives",java.util.List.of()));
  assertDoesNotThrow(()->CampaignReceipts.binding(mapper.valueToTree(payload),receipt,campaign,user,actor));var missing=new java.util.HashMap<>(payload);missing.remove("baselineArchives");assertThrows(IllegalArgumentException.class,()->CampaignReceipts.binding(mapper.valueToTree(missing),receipt,campaign,user,actor));var altered=new java.util.HashMap<>(payload);altered.put("baselineArchives",Map.of("campaignId",campaign,"evaluationState","succeeded","evaluationDecision","pass","campaignArchive",Map.of(),"childArchives",java.util.List.of()));assertThrows(IllegalArgumentException.class,()->CampaignReceipts.binding(mapper.valueToTree(altered),receipt,campaign,user,actor));
 }
 @Test void signedHistoricalPayloadMustRemainInItsOrganizationProjectAndActor() {
  UUID id=UUID.randomUUID(),campaign=UUID.randomUUID(),actor=UUID.randomUUID();var user=new DemoUser("test","unused",UUID.randomUUID(),UUID.randomUUID(),actor,"admin");
  var payload=new ObjectMapper().valueToTree(Map.of("schemaVersion",1,"kind","campaign-gate-observation","trustDomain",GateSigner.TRUST_DOMAIN,"currentDeploymentAuthority",false,"receiptId",id.toString(),"campaignId",campaign.toString(),"organizationId",user.organizationId().toString(),"projectId",user.projectId().toString(),"actorId",actor.toString()));
  assertDoesNotThrow(()->CampaignReceipts.binding(payload,id,campaign,user,actor));assertThrows(IllegalArgumentException.class,()->CampaignReceipts.binding(payload,UUID.randomUUID(),campaign,user,actor));assertThrows(IllegalArgumentException.class,()->CampaignReceipts.binding(payload,id,campaign,user,UUID.randomUUID()));
 }
 @Test void evenSignedBytesCannotClaimCurrentDeploymentAuthority() {
  UUID id=UUID.randomUUID(),actor=UUID.randomUUID();var user=new DemoUser("test","unused",UUID.randomUUID(),UUID.randomUUID(),actor,"admin");
  var payload=new ObjectMapper().valueToTree(Map.of("schemaVersion",1,"kind","campaign-gate-observation","trustDomain",GateSigner.TRUST_DOMAIN,"currentDeploymentAuthority",true,"receiptId",id.toString(),"campaignId",id.toString(),"organizationId",user.organizationId().toString(),"projectId",user.projectId().toString(),"actorId",actor.toString()));
  assertThrows(IllegalArgumentException.class,()->CampaignReceipts.binding(payload,id,id,user,actor));
 }
}
