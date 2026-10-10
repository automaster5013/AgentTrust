package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class CampaignReceiptsTest {
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
