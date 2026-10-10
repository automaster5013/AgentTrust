package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class CampaignBindingTest {
 @Test void wrongOrMissingVersionProofCannotPersistCampaignCompletion(){
  JdbcTemplate jdbc=mock(JdbcTemplate.class);UUID id=UUID.randomUUID(),campaign=UUID.randomUUID(),agent=UUID.randomUUID(),dataset=UUID.randomUUID();
  DemoUser user=new DemoUser("worker","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
  RunService service=new RunService(jdbc,null,new ObjectMapper(),null){@Override <T>T scoped(DemoUser u,Supplier<T> action){return action.get();}};
  when(jdbc.queryForList(startsWith("SELECT scenario,state"),eq(id),eq(user.organizationId()),eq(user.projectId()))).thenReturn(List.of(Map.of("scenario","pass","state","queued","actor_id",user.actorId(),"provider","synthetic","expired",false)));
  when(jdbc.queryForList(startsWith("SELECT c.campaign_id"),eq(id))).thenReturn(List.of(Map.of("campaign_id",campaign,"case_id","output","agent_version_id",agent,"dataset_version_id",dataset)));
  var result=new Evaluation.Result("succeeded","pass",List.of(new Evaluation.Rule("required-output",true,"pass","Ready")),"python-synthetic");
  assertThrows(ResponseStatusException.class,()->service.complete(user,id,"pass",result));
  assertThrows(ResponseStatusException.class,()->service.complete(user,id,"pass",result,new RunService.CampaignBinding(campaign,"output",UUID.randomUUID(),dataset)));
  verify(jdbc,never()).update(startsWith("INSERT INTO stack_run_results"),any(),any(),any(),any(),any(),any());
  service.complete(user,id,"pass",result,new RunService.CampaignBinding(campaign,"output",agent,dataset));
  verify(jdbc).update(startsWith("INSERT INTO stack_run_results"),eq(id),eq(user.organizationId()),eq(user.projectId()),eq("succeeded"),eq("pass"),anyString());
 }
}
