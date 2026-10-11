package dev.agenttrust.core;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
/** One scoped immutable observation and its exact archived byte chain, never a deployment token. */
@Service
@ConditionalOnProperty(name="agenttrust.gate-signing-mode",havingValue="local-development")
public class CampaignObservationBundles {
 private final CampaignReceipts receipts;private final CampaignArchives parents;private final EvidenceArchives children;private final CampaignService campaigns;private final RunService runs;private final ObjectMapper mapper;
 public CampaignObservationBundles(CampaignReceipts receipts,CampaignArchives parents,EvidenceArchives children,CampaignService campaigns,RunService runs,ObjectMapper mapper){this.receipts=receipts;this.parents=parents;this.children=children;this.campaigns=campaigns;this.runs=runs;this.mapper=mapper;}
 static void bound(JsonNode payload,Map<String,Object> parent){
  var value=payload.path("campaignArchive");if(!value.isObject()||value.size()!=3||!value.path("contentSha256").asText().equals(parent.get("contentSha256"))||!value.path("storageVersion").asText().equals(parent.get("storageVersion"))||!value.path("contentBytes").isIntegralNumber()||value.path("contentBytes").asInt()!=(Integer)parent.get("contentBytes"))throw new IllegalArgumentException("Observation archive differs");
 }
 private ArrayList<Map<String,Object>> archivedChildren(DemoUser user,UUID campaign,JsonNode references){
  var cases=runs.scoped(user,()->campaigns.cases(user,campaign));if(!references.isArray()||references.size()!=cases.size()||cases.isEmpty()||cases.size()>8)throw new IllegalArgumentException("Observation cases differ");
  var values=new ArrayList<Map<String,Object>>();
  for(int i=0;i<cases.size();i++){UUID runId=cases.get(i).runId();var run=runs.get(user,runId);var archive=children.evidence(user,runId);var reference=references.get(i);if(reference.size()!=4||!reference.path("runId").asText().equals(runId.toString())||!reference.path("contentSha256").asText().equals(archive.get("contentSha256"))||!reference.path("storageVersion").asText().equals(archive.get("storageVersion"))||!reference.path("contentBytes").isIntegralNumber()||reference.path("contentBytes").asInt()!=(Integer)archive.get("contentBytes"))throw new IllegalArgumentException("Observation child archive differs");values.add(Map.of("run",run,"archive",archive));}return values;
 }
 public Map<String,Object> get(DemoUser user,UUID campaign,UUID id){
  // Scope and signature are checked before any storage read, including during outages.
  var receipt=receipts.get(user,campaign,id);var record=campaigns.get(user,campaign);var parent=parents.evidence(user,campaign);
  try{
   var payload=mapper.readTree(Base64.getDecoder().decode((String)receipt.get("payloadBase64")));bound(payload,parent);var values=archivedChildren(user,campaign,payload.path("childArchives"));
   var bundle=new java.util.HashMap<String,Object>(Map.<String,Object>of("schemaVersion",1,"kind","campaign-observation-bundle","currentDeploymentAuthority",false,"campaign",record,"receipt",receipt,"parent",parent,"children",values));
   if(payload.path("schemaVersion").asInt()==3){
    UUID baseline=UUID.fromString(payload.path("releaseRequirements").path("baselineCampaignId").asText());var baselineRecord=campaigns.get(user,baseline);var baselineParent=parents.evidence(user,baseline);var requirements=campaigns.releaseRequirements(user,campaign);
    var expected=CampaignBaselineArchives.binding(user,requirements,baselineRecord,baselineParent,mapper);if(!mapper.valueToTree(expected).equals(payload.path("baselineArchives")))throw new IllegalArgumentException("Signed baseline archive differs");
    var baselineChildren=archivedChildren(user,baseline,payload.path("baselineArchives").path("childArchives"));bundle.put("schemaVersion",2);bundle.put("baseline",Map.of("campaign",baselineRecord,"parent",baselineParent,"children",baselineChildren));
   }
   if(mapper.writeValueAsBytes(bundle).length>524288)throw new IllegalArgumentException("Observation bundle exceeds bound");return bundle;
  }catch(ResponseStatusException unavailable){throw unavailable;}catch(Exception invalid){throw new ResponseStatusException(HttpStatus.BAD_GATEWAY);}
 }
}
