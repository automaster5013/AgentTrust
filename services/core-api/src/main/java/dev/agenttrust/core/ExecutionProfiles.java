package dev.agenttrust.core;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
/** Public build-time snapshots; runtime worker independently computes and checks the same hash. */
public final class ExecutionProfiles {
 private ExecutionProfiles(){}
 static Map<String,Object> profile(ObjectMapper mapper,String provider){
  if(!List.of("synthetic","ollama","openai-compatible").contains(provider))throw new IllegalArgumentException("Unsupported fixed profile");
  try(var input=ExecutionProfiles.class.getResourceAsStream("/execution-profiles.json")){
   var entry=mapper.readTree(input).path(provider);var definition=entry.path("definition");String hash=entry.path("contentSha256").asText();
   if(!hash.matches("[a-f0-9]{64}")||!definition.path("provider").asText().equals(provider)||!definition.path("contract").asText().equals("fixed-execution-profile-v1")||!hash.equals(ArchiveIntegrity.sha256(mapper.writeValueAsBytes(canonical(mapper.convertValue(definition,Object.class))))))throw new IllegalStateException("Fixed execution profile unavailable");
   return Map.of("definition",definition,"contentSha256",hash);
  }catch(Exception unavailable){throw new IllegalStateException("Fixed execution profile unavailable");}
 }
 static Object canonical(Object value){if(value instanceof Map<?,?> map){var sorted=new TreeMap<String,Object>();map.forEach((key,item)->sorted.put((String)key,canonical(item)));return sorted;}if(value instanceof List<?> list)return list.stream().map(ExecutionProfiles::canonical).toList();return value;}
 static String binding(ObjectMapper mapper,String content,String storedHash){
  if(content==null)throw new IllegalStateException("Version execution profile unavailable");
  try{
   if(!ArchiveIntegrity.sha256(content.getBytes(java.nio.charset.StandardCharsets.UTF_8)).equals(storedHash))throw new IllegalArgumentException("Version source hash differs");
   var definition=mapper.readTree(content);if(definition.path("contract").asText().equals(VersionDefinition.CONTRACT))return null;
   if(!definition.path("contract").asText().equals("fixed-scenarios-v2"))throw new IllegalArgumentException("Unsupported agent contract");
   var profile=definition.path("executionProfile");String hash=definition.path("executionProfileSha256").asText();
   if(!hash.matches("[a-f0-9]{64}")||!profile.path("provider").asText().equals(definition.path("provider").asText())||!hash.equals(ArchiveIntegrity.sha256(mapper.writeValueAsBytes(canonical(mapper.convertValue(profile,Object.class))))))throw new IllegalArgumentException("Version execution profile differs");return hash;
  }catch(Exception invalid){throw new IllegalStateException("Version execution profile unavailable");}
 }
}
