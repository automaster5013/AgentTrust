package dev.agenttrust.core;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Set;
import java.util.UUID;

record AuditFilters(String action,UUID resourceId) {
 static final Set<String> ACTIONS=Set.of("evaluation.queued","evaluation.completed","evaluation.cancelled","review.approved","review.rejected","version.agents.registered","version.datasets.registered","version.agents.retired","version.datasets.retired","campaign.queued","campaign.cancelled","campaign.review.approved","campaign.review.rejected","campaign.observation.signed");
 static AuditFilters parse(String action,String resource){
  if(action==null||resource==null||!action.equals("all")&&!ACTIONS.contains(action))throw new IllegalArgumentException("Invalid audit filter");
  UUID id=null;if(!resource.equals("all")){try{id=UUID.fromString(resource);}catch(RuntimeException invalid){throw new IllegalArgumentException("Invalid audit resource");}if(!id.toString().equals(resource))throw new IllegalArgumentException("Invalid audit resource");}
  return new AuditFilters(action.equals("all")?null:action,id);
 }
 byte[] digest(){try{return MessageDigest.getInstance("SHA-256").digest(("action="+(action==null?"all":action)+";resource="+(resourceId==null?"all":resourceId)).getBytes(StandardCharsets.US_ASCII));}catch(java.security.NoSuchAlgorithmException unavailable){throw new IllegalStateException(unavailable);}}
}
