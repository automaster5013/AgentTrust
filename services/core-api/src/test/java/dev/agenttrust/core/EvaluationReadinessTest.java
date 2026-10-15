package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class EvaluationReadinessTest {
 @Test void successfulRoleCheckCannotHideUnavailableWorkspaceDiscovery(){
  var jdbc=mock(org.springframework.jdbc.core.JdbcTemplate.class);var pending=mock(PendingWorkspaceScopes.class);
  var runs=new RunService(jdbc,null,null,null){@Override <T>T scoped(DemoUser user,java.util.function.Supplier<T> action){return action.get();}};
  var reader=new EvaluationReadiness(runs,jdbc,null,new ObjectMapper(),pending);
  var user=new DemoUser("reader","unused",java.util.UUID.randomUUID(),java.util.UUID.randomUUID(),java.util.UUID.randomUUID(),"viewer");
  when(jdbc.queryForObject(anyString(),eq(Boolean.class),anyString(),anyString())).thenReturn(true);
  when(pending.after(null)).thenThrow(new IllegalStateException("fixture capability unavailable"));
  assertFalse(reader.databaseAvailable(user));
 }
 @Test void failedRoleCheckCannotInvokePrivilegedMetadataCapability(){
  var jdbc=mock(org.springframework.jdbc.core.JdbcTemplate.class);var pending=mock(PendingWorkspaceScopes.class);
  var runs=new RunService(jdbc,null,null,null){@Override <T>T scoped(DemoUser user,java.util.function.Supplier<T> action){return action.get();}};
  var reader=new EvaluationReadiness(runs,jdbc,null,new ObjectMapper(),pending);
  var user=new DemoUser("reader","unused",java.util.UUID.randomUUID(),java.util.UUID.randomUUID(),java.util.UUID.randomUUID(),"viewer");
  when(jdbc.queryForObject(anyString(),eq(Boolean.class),anyString(),anyString())).thenReturn(false);
  assertFalse(reader.databaseAvailable(user));verifyNoInteractions(pending);
 }
 @Test void incompleteContradictoryOrExtendedWorkerResponseFailsClosed(){
  var mapper=new ObjectMapper();var value=mapper.createObjectNode().put("contract","agenttrust-worker-readiness-v1").put("ready",true).put("fixedConsumerReady",true).put("referenceConsumerReady",true).put("queueReady",true);
  assertTrue(EvaluationReadiness.validWorker(value));
  for(String key:java.util.List.of("ready","fixedConsumerReady","referenceConsumerReady","queueReady")){
   assertFalse(EvaluationReadiness.validWorker(value.deepCopy().put(key,false)));
   assertFalse(EvaluationReadiness.validWorker(value.deepCopy().put(key,"true")));
   var missing=value.deepCopy();missing.remove(key);assertFalse(EvaluationReadiness.validWorker(missing));
  }
  assertFalse(EvaluationReadiness.validWorker(value.deepCopy().put("extra","private")));
  assertFalse(EvaluationReadiness.validWorker(value.deepCopy().put("contract","other")));
 }
}
