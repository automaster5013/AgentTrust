package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
/** Signed metadata for the separately archived immutable comparison campaign. */
final class CampaignBaselineArchives {
 private CampaignBaselineArchives(){}
 static Map<String,Object> binding(DemoUser user,Map<String,Object> requirements,Map<String,Object> record,Map<String,Object> proof,ObjectMapper mapper)throws Exception{
  if(!Boolean.TRUE.equals(requirements.get("enabled"))||!Objects.equals(requirements.get("baselineCampaignId"),record.get("id"))||!user.organizationId().equals(record.get("organization_id"))||!user.projectId().equals(record.get("project_id"))||!Objects.equals(requirements.get("baselineAgentVersionId"),record.get("agent_version_id"))||!Objects.equals(requirements.get("baselineAgentContentSha256"),record.get("agent_content_sha256"))||!Objects.equals(requirements.get("datasetVersionId"),record.get("dataset_version_id"))||!Objects.equals(requirements.get("datasetContentSha256"),record.get("dataset_content_sha256"))||!List.of("succeeded","failed").contains(record.get("state")))throw new IllegalArgumentException("Baseline archive scope differs");
  byte[] bytes=Base64.getDecoder().decode((String)proof.get("contentBase64"));ArchiveIntegrity.verify(bytes,(String)proof.get("contentSha256"),(Integer)proof.get("contentBytes"));ArchiveIntegrity.version((String)proof.get("storageVersion"));
  var archived=mapper.readTree(bytes);var stored=archived.path("campaign");if(!stored.path("id").asText().equals(record.get("id").toString())||!stored.path("organization_id").asText().equals(user.organizationId().toString())||!stored.path("project_id").asText().equals(user.projectId().toString())||!archived.path("childArchives").isArray()||archived.path("childArchives").isEmpty()||archived.path("childArchives").size()>8)throw new IllegalArgumentException("Baseline archive binding differs");
  CampaignArchives.validate(archived,mapper.valueToTree(CampaignArchives.normalized(record)),archived.path("childArchives"));
  return Map.of("campaignId",record.get("id"),"evaluationState",record.get("state"),"evaluationDecision",record.get("decision"),"campaignArchive",Map.of("contentSha256",proof.get("contentSha256"),"contentBytes",proof.get("contentBytes"),"storageVersion",proof.get("storageVersion")),"childArchives",archived.path("childArchives"));
 }
}
