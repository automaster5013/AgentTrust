package dev.agenttrust.core;
import java.sql.Timestamp;import java.time.Instant;import java.util.*;
import org.junit.jupiter.api.Test;import com.fasterxml.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;import static org.mockito.ArgumentMatchers.*;
class VersionRegistrationPrecisionTest {
 @Test void registrationAndDetailUseTheSameExactMicrosecondCoordinateWithoutMutatingRegistryRows(){
  var registry=mock(VersionRegistry.class);var controller=new VersionController(registry,new ObjectMapper());var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"editor");var time=Instant.parse("2026-11-12T00:00:00.123456Z");var timestamp=Timestamp.from(time);var id=UUID.randomUUID();Map<String,Object> row=Map.of("id",id,"created_at",timestamp);
  when(registry.register(eq(user),eq("datasets"),eq("example"),eq(1),anyString())).thenReturn(row);when(registry.registerAgent(user,"example",1,"synthetic","fixture","fixed-scenarios")).thenReturn(row);when(registry.get(user,"datasets",id)).thenReturn(row);
  var response=controller.dataset(user,new VersionController.Dataset("example",1,List.of(new VersionDefinition.Case("required-pass","pass",true)),"fixed-scenarios"));assertEquals(time.toString(),response.get("created_at"));assertEquals(controller.get(user,"datasets",id),response);assertEquals(time.toString(),controller.agent(user,new VersionController.Agent("example",1,"synthetic","fixture","fixed-scenarios")).get("created_at"));assertSame(timestamp,row.get("created_at"));
 }
}
