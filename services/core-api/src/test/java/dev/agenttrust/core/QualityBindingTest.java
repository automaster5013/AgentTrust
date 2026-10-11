package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class QualityBindingTest {
 @Test void immutableInputAndReferenceAreCheckedBeforeReservationOrCompletion(){
  var mapper=new ObjectMapper();var jdbc=mock(JdbcTemplate.class);UUID run=UUID.randomUUID(),campaign=UUID.randomUUID(),agent=UUID.randomUUID(),dataset=UUID.randomUUID();
  var user=new DemoUser("worker","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
  var service=new RunService(jdbc,null,mapper,null){@Override <T>T scoped(DemoUser u,Supplier<T> action){return action.get();}};
  String agentJson=QualityDefinition.agent(mapper,"ollama","fixture"),agentHash=ArchiveIntegrity.sha256(agentJson.getBytes(StandardCharsets.UTF_8));
  String data=QualityDefinition.dataset(mapper,List.of(new VersionDefinition.Case("ready","quality",true,"Return READY","READY"))),dataHash=ArchiveIntegrity.sha256(data.getBytes(StandardCharsets.UTF_8));
  String profile=ExecutionProfiles.binding(mapper,agentJson,agentHash);
  var row=new HashMap<String,Object>();row.put("campaign_id",campaign);row.put("case_id","ready");row.put("agent_version_id",agent);row.put("dataset_version_id",dataset);row.put("content_json",agentJson);row.put("content_sha256",agentHash);row.put("admitted_agent_hash",agentHash);row.put("dataset_json",data);row.put("dataset_hash",dataHash);row.put("admitted_dataset_hash",dataHash);row.put("case_index",0);row.put("required",true);
  when(jdbc.queryForList(startsWith("SELECT c.campaign_id"),eq(run))).thenReturn(List.of(row));
  var correct=new RunService.CampaignBinding(campaign,"ready",agent,dataset,profile,QualityDefinition.sample(mapper,"Return READY","READY"));
  assertDoesNotThrow(()->service.validateBinding(user,run,correct));
  assertThrows(ResponseStatusException.class,()->service.validateBinding(user,run,new RunService.CampaignBinding(campaign,"ready",agent,dataset,profile)));
  for(var sample:List.of(QualityDefinition.sample(mapper,"Return DENIED","READY"),QualityDefinition.sample(mapper,"Return READY","DENIED")))assertThrows(ResponseStatusException.class,()->service.validateBinding(user,run,new RunService.CampaignBinding(campaign,"ready",agent,dataset,profile,sample)));
  row.put("admitted_dataset_hash","b".repeat(64));assertThrows(IllegalStateException.class,()->service.validateBinding(user,run,correct));
  verify(jdbc,never()).update(anyString(),any(Object[].class));
 }
}
