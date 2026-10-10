package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class CompletionDeadlineTest {
 private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
 private final ObjectMapper mapper=new ObjectMapper();
 private final UUID id=UUID.randomUUID();
 private final DemoUser scope=new DemoUser("worker","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 private final RunService runs=new RunService(jdbc,null,mapper,null){@Override <T>T scoped(DemoUser user,Supplier<T> action){return action.get();}};
 private final Evaluation.Result success=new Evaluation.Result("succeeded","pass",List.of(new Evaluation.Rule("required-output",true,"pass","READY")),"python-synthetic");
 private void fixture(boolean expired,boolean completed){
  when(jdbc.queryForList(startsWith("SELECT scenario,state"),eq(id),eq(scope.organizationId()),eq(scope.projectId()))).thenReturn(List.of(Map.of("scenario","pass","state","queued","actor_id",scope.actorId(),"provider","synthetic","expired",expired)));
  when(jdbc.queryForList("SELECT run_id FROM stack_run_results WHERE run_id=?",id)).thenReturn(completed?List.of(Map.of("run_id",id)):List.of());
 }
 @Test void lateSuccessCannotOpenGateBeforeDispatcherNoticesDeadline() throws Exception {
  fixture(true,false);runs.complete(scope,id,"pass",success);var body=ArgumentCaptor.forClass(String.class);
  verify(jdbc).update(startsWith("INSERT INTO stack_run_results"),eq(id),eq(scope.organizationId()),eq(scope.projectId()),eq("failed"),eq("inconclusive"),body.capture());
  var evidence=mapper.readTree(body.getValue());assertEquals("python-unavailable",evidence.get("executionEngine").asText());assertEquals("inconclusive",evidence.get("rules").get(0).get("status").asText());
 }
 @Test void timelySuccessKeepsAuthoritativeEvidence(){
  fixture(false,false);runs.complete(scope,id,"pass",success);
  verify(jdbc).update(startsWith("INSERT INTO stack_run_results"),eq(id),eq(scope.organizationId()),eq(scope.projectId()),eq("succeeded"),eq("pass"),anyString());
 }
 @Test void expiredReplayNeverReplacesAnAlreadyStoredResult(){
  fixture(true,true);assertEquals(true,runs.complete(scope,id,"pass",success).get("duplicate"));
  verify(jdbc,never()).update(startsWith("INSERT INTO stack_run_results"),any(),any(),any(),any(),any(),any());
 }
}
