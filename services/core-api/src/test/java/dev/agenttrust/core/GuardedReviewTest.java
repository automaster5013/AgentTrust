package dev.agenttrust.core;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class GuardedReviewTest {
 private final DemoUser user=new DemoUser("admin","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"admin");
 private final UUID id=UUID.randomUUID();
 @Test void staleEvaluationCannotAppendApprovalOrAuditAfterAnotherReview() {
  var jdbc=mock(JdbcTemplate.class);
  var service=new RunService(jdbc,null,null,null){
   @Override <T>T scoped(DemoUser user,Supplier<T> action){return action.get();}
   @Override public Map<String,Object> get(DemoUser user,UUID id){return Map.of("decision","pass");}
   @Override public List<Map<String,Object>> reviews(DemoUser user,UUID id){return List.of(Map.of("review_sequence",7L,"decision","rejected"));}
  };
  var error=assertThrows(ResponseStatusException.class,()->service.review(user,id,"approved","observed before rejection",6L));assertEquals(409,error.getStatusCode().value());
  verify(jdbc).queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"review/"+id);verifyNoMoreInteractions(jdbc);
 }
 @Test void staleCampaignCannotAppendApprovalOrAuditAfterAnotherReview() {
  var runs=mock(RunService.class);var jdbc=mock(JdbcTemplate.class);
  when(runs.scoped(eq(user),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());
  when(jdbc.queryForList(startsWith("SELECT id,decision,reason"),eq(id),eq(user.organizationId()),eq(user.projectId()))).thenReturn(List.of(Map.of("review_sequence",9L,"decision","rejected")));
  var service=new CampaignService(runs,null,jdbc,null,null,null){@Override public Map<String,Object> get(DemoUser user,UUID id){return Map.of("decision","pass");}};
  var error=assertThrows(ResponseStatusException.class,()->service.review(user,id,"approved","observed before rejection",8L));assertEquals(409,error.getStatusCode().value());
  verify(jdbc).queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"campaign-review/"+id);
  verify(jdbc).queryForList(contains("ORDER BY review_sequence DESC LIMIT 50"),eq(id),eq(user.organizationId()),eq(user.projectId()));verifyNoMoreInteractions(jdbc);
  verify(runs).scoped(eq(user),any());verifyNoMoreInteractions(runs);
 }
}
