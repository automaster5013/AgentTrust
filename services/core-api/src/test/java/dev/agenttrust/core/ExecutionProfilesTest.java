package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class ExecutionProfilesTest {
 private final ObjectMapper mapper=new ObjectMapper();
 @Test void newAgentVersionsBindCanonicalInstalledWorkerProfile() throws Exception {
  String content=VersionDefinition.agent(mapper,"ollama","fixture"),hash=ArchiveIntegrity.sha256(content.getBytes(StandardCharsets.UTF_8));var definition=mapper.readTree(content);
  assertEquals("fixed-scenarios-v2",definition.path("contract").asText());assertEquals(definition.path("executionProfileSha256").asText(),ExecutionProfiles.binding(mapper,content,hash));assertEquals("qwen3:0.6b",definition.path("executionProfile").path("model").asText());
  var changed=definition.deepCopy();((com.fasterxml.jackson.databind.node.ObjectNode)changed.path("executionProfile")).put("model","substituted");String different=mapper.writeValueAsString(changed);assertThrows(IllegalStateException.class,()->ExecutionProfiles.binding(mapper,different,ArchiveIntegrity.sha256(different.getBytes(StandardCharsets.UTF_8))));assertThrows(IllegalStateException.class,()->ExecutionProfiles.binding(mapper,content,"0".repeat(64)));
 }
 @Test void oldVersionsRemainExplicitlyUnbound() throws Exception {
  assertThrows(IllegalStateException.class,()->ExecutionProfiles.binding(mapper,null,null));
  String content="{\"contract\":\"fixed-scenarios-v1\",\"description\":\"fixture\",\"provider\":\"synthetic\"}";assertNull(ExecutionProfiles.binding(mapper,content,ArchiveIntegrity.sha256(content.getBytes(StandardCharsets.UTF_8))));
 }
}
