package dev.agenttrust.core;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
class VersionLifecycleTest {
 @Test void retirementReasonMustBeBoundedAndNonblank(){
  assertEquals("Superseded",VersionLifecycle.reason("  Superseded  "));
  for(String reason:new String[]{null,"","  ","x".repeat(501)})assertThrows(ResponseStatusException.class,()->VersionLifecycle.reason(reason));
  assertEquals(500,VersionLifecycle.reason("x".repeat(500)).length());
 }
}
