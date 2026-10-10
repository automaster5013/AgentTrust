package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class VersionDefinitionTest {
 private final ObjectMapper mapper=new ObjectMapper();
 @Test void casesAreBoundedUniqueAndNeedRequiredEvidence(){
  var passing=new VersionDefinition.Case("answer","pass",true);
  assertThrows(IllegalArgumentException.class,()->VersionDefinition.dataset(mapper,List.of(passing,passing)));
  assertThrows(IllegalArgumentException.class,()->VersionDefinition.dataset(mapper,List.of(new VersionDefinition.Case("optional","pass",false))));
  assertThrows(IllegalArgumentException.class,()->VersionDefinition.dataset(mapper,List.of(new VersionDefinition.Case("code","arbitrary",true))));
  assertThrows(IllegalArgumentException.class,()->VersionDefinition.dataset(mapper,java.util.stream.IntStream.range(0,9).mapToObj(i->new VersionDefinition.Case("case-"+i,"pass",true)).toList()));
 }
 @Test void canonicalDefinitionHashIncludesProviderAndRequiredCase(){
  String a=VersionDefinition.agent(mapper,"synthetic","fixture"),b=VersionDefinition.agent(mapper,"ollama","fixture");
  assertNotEquals(ArchiveIntegrity.sha256(a.getBytes(java.nio.charset.StandardCharsets.UTF_8)),ArchiveIntegrity.sha256(b.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  assertEquals(a,VersionDefinition.agent(mapper,"synthetic","fixture"));
  assertThrows(IllegalArgumentException.class,()->VersionDefinition.agent(mapper,"https://caller.invalid","fixture"));
  assertThrows(IllegalArgumentException.class,()->VersionDefinition.agent(mapper,null,"fixture"));
  assertThrows(IllegalArgumentException.class,()->VersionDefinition.coordinate("../unsafe",1));
  assertThrows(IllegalArgumentException.class,()->VersionDefinition.coordinate("fixture",0));
 }
}
