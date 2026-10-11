package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class QualityDefinitionTest {
 private final ObjectMapper mapper=new ObjectMapper();
 @Test void referenceModeIsExplicitAndCannotChangeFixedCanonicalContent()throws Exception{
  assertFalse(VersionController.reference(null));assertTrue(VersionController.reference("reference-answer"));assertThrows(IllegalArgumentException.class,()->VersionController.reference("custom-code"));
  assertEquals("{\"cases\":[{\"id\":\"ready\",\"required\":true,\"scenario\":\"pass\"}],\"contract\":\"fixed-scenarios-v1\"}",VersionDefinition.dataset(mapper,List.of(new VersionDefinition.Case("ready","pass",true))));
  assertThrows(IllegalArgumentException.class,()->VersionDefinition.dataset(mapper,List.of(new VersionDefinition.Case("ready","pass",true,"input","expected"))));
  var content=QualityDefinition.agent(mapper,"ollama","fixture");assertEquals("reference-answer-v1",mapper.readTree(content).path("contract").asText());assertNotNull(ExecutionProfiles.binding(mapper,content,ArchiveIntegrity.sha256(content.getBytes(java.nio.charset.StandardCharsets.UTF_8))));
  assertThrows(IllegalArgumentException.class,()->QualityDefinition.agent(mapper,"synthetic","fixture"));
 }
 @Test void samplesAreUtf8BoundedAndRequiredCasesCannotBeOmitted(){
  var good=new VersionDefinition.Case("ready","quality",true,"Return READY","READY");assertNotNull(QualityDefinition.dataset(mapper,List.of(good)));
  for(var cases:List.of(List.<VersionDefinition.Case>of(),List.of(good,good),List.of(good,new VersionDefinition.Case("second","quality",true,"x","x"),new VersionDefinition.Case("third","quality",true,"x","x")),List.of(new VersionDefinition.Case("ready","quality",false,"x","x")),List.of(new VersionDefinition.Case("ready","pass",true,"x","x"))))assertThrows(IllegalArgumentException.class,()->QualityDefinition.dataset(mapper,cases));
  for(String value:List.of("","x\u0000y","é".repeat(97),"\uD800"))assertThrows(IllegalArgumentException.class,()->QualityDefinition.sample(mapper,value,"READY"));
  assertThrows(IllegalArgumentException.class,()->QualityDefinition.sample(mapper,"x","é".repeat(65)));
 }
 @Test void hashBindsInputAndExpectedExactly()throws Exception{
  var first=QualityDefinition.sample(mapper,"Return READY","READY");assertEquals(first,QualityDefinition.sample(mapper,"Return READY","READY"));
  assertNotEquals(first.get("contentSha256"),QualityDefinition.sample(mapper,"Return READY","DENIED").get("contentSha256"));
  assertNotEquals(first.get("contentSha256"),QualityDefinition.sample(mapper,"Return DENIED","READY").get("contentSha256"));
 }
}
