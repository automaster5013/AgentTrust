package dev.agenttrust.core;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class VersionCapacityTest {
 final RunService runs=mock(RunService.class);final JdbcTemplate jdbc=mock(JdbcTemplate.class);final VersionCapacity capacity=new VersionCapacity(runs,jdbc);
 final DemoUser user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 void result(Map<String,Object> result){when(runs.scoped(eq(user),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());when(jdbc.queryForMap(anyString(),eq(user.organizationId()),eq(user.projectId()),eq(user.organizationId()),eq(user.projectId()))).thenReturn(result);}
 @Test void viewerReadsBothRetainedCountsInOneScopedStatementWithoutReservation(){result(Map.of("agents",199L,"datasets",200L));var value=capacity.read(user);assertEquals(user.projectId(),value.projectId());assertEquals("project",value.scope());assertEquals(new VersionCapacity.Count(199,200,1,false),value.agents());assertEquals(new VersionCapacity.Count(200,200,0,true),value.datasets());assertFalse(value.reservationGranted());assertFalse(value.deploymentAuthority());var sql=org.mockito.ArgumentCaptor.forClass(String.class);verify(jdbc).queryForMap(sql.capture(),eq(user.organizationId()),eq(user.projectId()),eq(user.organizationId()),eq(user.projectId()));assertTrue(sql.getValue().startsWith("SELECT "));assertTrue(sql.getValue().contains("stack_agent_versions WHERE organization_id=? AND project_id=?"));assertTrue(sql.getValue().contains("stack_dataset_versions WHERE organization_id=? AND project_id=?"));assertFalse(sql.getValue().contains("lifecycle"));verifyNoMoreInteractions(jdbc);verify(runs).scoped(eq(user),any());}
 @Test void zeroAndOverLimitCountsRemainTruthfulWithoutChangingAdmissionLimit(){for(long used:new long[]{0,200,201}){result(Map.of("agents",used,"datasets",used));var value=capacity.read(user);assertEquals(used,value.agents().used());assertEquals(Math.max(0,200-used),value.agents().remaining());assertEquals(used>=200,value.agents().exhausted());}}
 @Test void anonymousCannotReadCounts(){assertEquals(401,assertThrows(ResponseStatusException.class,()->capacity.read(null)).getStatusCode().value());verifyNoInteractions(runs,jdbc);}
 @Test void invalidOrPartialCountsCannotBecomeZeroOrPartialSuccess(){for(Object invalid:List.of(-1L,0.5,Double.NaN,9_007_199_254_740_992L,"unknown")){result(Map.of("agents",1L,"datasets",invalid));assertThrows(IllegalStateException.class,()->capacity.read(user));}result(Map.of("agents",1L));assertThrows(IllegalStateException.class,()->capacity.read(user));}
}
