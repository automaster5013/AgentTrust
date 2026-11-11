package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class RunComparisonTest {
 final RunService runs=mock(RunService.class);
 final RunComparison comparison=new RunComparison(runs);
 final UUID baseline=UUID.randomUUID(),candidate=UUID.randomUUID();
 final DemoUser user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 Map<String,Object> run(UUID id,String state,String decision,String rules)throws Exception{
  return new HashMap<>(Map.of("id",id,"organization_id",user.organizationId(),"project_id",user.projectId(),"state",state,"decision",decision,"result",new ObjectMapper().readTree("{\"state\":\""+state+"\",\"decision\":\""+decision+"\",\"rules\":"+rules+"}")));
 }
 final String passing="[{\"id\":\"answer\",\"required\":true,\"status\":\"pass\"}]";
 @Test void viewerCanCompareWithoutGrantingDeploymentOrRegressionAuthority()throws Exception{
  when(runs.get(user,baseline)).thenReturn(run(baseline,"succeeded","pass",passing));
  when(runs.get(user,candidate)).thenReturn(run(candidate,"succeeded","block",passing.replace("\"pass\"","\"fail\"")));
  var result=comparison.compare(user,candidate,baseline);
  assertEquals(false,result.get("deploymentAuthority"));assertEquals(false,result.get("regressionAuthority"));assertEquals(1,result.get("changedRules"));
  assertEquals(user.projectId(),result.get("projectId"));verify(runs).get(user,baseline);verify(runs).get(user,candidate);verifyNoMoreInteractions(runs);
 }
 @Test void crossProjectResultCannotBeExposed()throws Exception{
  var other=run(baseline,"succeeded","pass",passing);other.put("project_id",UUID.randomUUID());when(runs.get(user,baseline)).thenReturn(other);
  assertEquals(404,assertThrows(ResponseStatusException.class,()->comparison.compare(user,candidate,baseline)).getStatusCode().value());verify(runs,never()).get(user,candidate);
 }
 @Test void missingForeignCandidatePreservesScopedNotFound()throws Exception{
  when(runs.get(user,baseline)).thenReturn(run(baseline,"succeeded","pass",passing));when(runs.get(user,candidate)).thenThrow(new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND));
  assertEquals(404,assertThrows(ResponseStatusException.class,()->comparison.compare(user,candidate,baseline)).getStatusCode().value());
 }
 @Test void anonymousAndSelfComparisonRefusedBeforeAnyRead(){
  assertEquals(401,assertThrows(ResponseStatusException.class,()->comparison.compare(null,candidate,baseline)).getStatusCode().value());
  assertEquals(400,assertThrows(ResponseStatusException.class,()->comparison.compare(user,candidate,candidate)).getStatusCode().value());verifyNoInteractions(runs);
 }
 @Test void queuedRunCannotBePresentedAsCompletedComparison()throws Exception{
  when(runs.get(user,baseline)).thenReturn(run(baseline,"queued","inconclusive",passing));
  assertEquals(409,assertThrows(ResponseStatusException.class,()->comparison.compare(user,candidate,baseline)).getStatusCode().value());
 }
 @Test void duplicateRulesFailClosed()throws Exception{
  when(runs.get(user,baseline)).thenReturn(run(baseline,"succeeded","pass",passing.replace("]",","+passing.substring(1))));when(runs.get(user,candidate)).thenReturn(run(candidate,"succeeded","pass",passing));
  assertThrows(IllegalStateException.class,()->comparison.compare(user,candidate,baseline));
 }
 @Test void missingRulesAreExplicitRatherThanCountedAsPassing()throws Exception{
  when(runs.get(user,baseline)).thenReturn(run(baseline,"succeeded","pass",passing));when(runs.get(user,candidate)).thenReturn(run(candidate,"failed","inconclusive",passing.replace("answer","other").replace("\"pass\"","\"inconclusive\"")));
  var result=comparison.compare(user,candidate,baseline);assertEquals(2,result.get("changedRules"));
  var rows=(List<?>)result.get("rules");assertEquals("missing",((Map<?,?>)rows.getFirst()).get("after"));
 }
}
