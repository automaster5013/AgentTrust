package dev.agenttrust.core;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class EvaluationOverviewTest {
 final RunService runs=mock(RunService.class);final JdbcTemplate jdbc=mock(JdbcTemplate.class);final EvaluationOverview overview=new EvaluationOverview(runs,jdbc);
 final DemoUser user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 Map<String,Object> fixture(){return new HashMap<>(Map.of("retained",70L,"queued",3L,"succeeded",65L,"failed",2L,"pass",40L,"block",20L,"inconclusive",10L,"inconsistent",0L));}
 void result(Map<String,Object> value){when(runs.scoped(eq(user),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());when(jdbc.queryForMap(anyString(),eq(user.organizationId()),eq(user.projectId()))).thenReturn(value);}
 @Test void fullProjectCountsUseEffectiveStateInOneScopedReadWithoutRecentLimit(){result(fixture());var value=overview.read(user);assertEquals(70,value.retainedCount());assertEquals(new EvaluationOverview.States(3,65,2),value.states());assertEquals(new EvaluationOverview.Decisions(40,20,10),value.decisions());assertEquals(user.organizationId(),value.organizationId());assertEquals(user.projectId(),value.projectId());assertFalse(value.deploymentAuthority());var sql=org.mockito.ArgumentCaptor.forClass(String.class);verify(jdbc).queryForMap(sql.capture(),eq(user.organizationId()),eq(user.projectId()));assertTrue(sql.getValue().contains("COALESCE(c.state,r.state)"));assertTrue(sql.getValue().contains("COALESCE(c.decision,r.decision)"));assertTrue(sql.getValue().contains("LEFT JOIN stack_run_results c ON c.run_id=r.id"));assertTrue(sql.getValue().contains("r.organization_id=? AND r.project_id=?"));assertFalse(sql.getValue().contains("LIMIT"));verifyNoMoreInteractions(jdbc);verify(runs).scoped(eq(user),any());}
 @Test void zeroIsAvailableOnlyWhenAllCountsAreActuallyZero(){var row=fixture();row.replaceAll((key,value)->0L);result(row);assertEquals(0,overview.read(user).retainedCount());}
 @Test void inconsistentOrPartialAggregatesCannotBecomeSuccess(){for(String key:fixture().keySet()){var row=fixture();row.remove(key);result(row);assertThrows(IllegalStateException.class,()->overview.read(user));}for(var change:List.of(Map.entry("retained",69L),Map.entry("inconclusive",9L),Map.entry("queued",11L),Map.entry("inconsistent",1L))){var row=fixture();row.put(change.getKey(),change.getValue());result(row);assertThrows(IllegalStateException.class,()->overview.read(user));}var row=fixture();row.put("queued",11L);row.put("succeeded",57L);result(row);assertThrows(IllegalStateException.class,()->overview.read(user));}
 @Test void invalidNumbersAreRejected(){for(Object invalid:List.of(-1L,0.5,Double.NaN,9_007_199_254_740_992L,"unknown")){var row=fixture();row.put("retained",invalid);result(row);assertThrows(IllegalStateException.class,()->overview.read(user));}}
 @Test void anonymousAndUnknownRolesCannotRead(){assertEquals(401,assertThrows(ResponseStatusException.class,()->overview.read(null)).getStatusCode().value());var denied=new DemoUser("fixture","unused",user.organizationId(),user.projectId(),user.actorId(),"other");assertEquals(403,assertThrows(ResponseStatusException.class,()->overview.read(denied)).getStatusCode().value());verifyNoInteractions(runs,jdbc);}
}
