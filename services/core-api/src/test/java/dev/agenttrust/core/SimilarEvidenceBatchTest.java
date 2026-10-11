package dev.agenttrust.core;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class SimilarEvidenceBatchTest {
    @Test void aFullRejectedPageCannotStarveTheNextPageAndFailuresRemainRetryable(){
        var service=mock(SimilarEvidence.class,CALLS_REAL_METHODS);var runs=mock(RunService.class);var jdbc=mock(org.springframework.jdbc.core.JdbcTemplate.class);var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
        org.springframework.test.util.ReflectionTestUtils.setField(service,"runs",runs);org.springframework.test.util.ReflectionTestUtils.setField(service,"jdbc",jdbc);org.springframework.test.util.ReflectionTestUtils.setField(service,"scopes",List.of(user));org.springframework.test.util.ReflectionTestUtils.setField(service,"positions",new java.util.HashMap<>());
        when(runs.scoped(eq(user),any())).thenAnswer(call->((java.util.function.Supplier<?>)call.getArgument(1)).get());
        var at=java.sql.Timestamp.from(java.time.Instant.parse("2026-10-12T00:00:00.123456Z"));var rejected=new ArrayList<Map<String,Object>>();for(int i=1;i<=20;i++)rejected.add(Map.of("run_id",new UUID(0,i),"completed_at",at));UUID good=new UUID(0,21);var queries=new ArrayList<String>();var boundaries=new ArrayList<Object[]>();
        when(jdbc.queryForList(anyString(),any(Object[].class))).thenAnswer(call->{queries.add(call.getArgument(0));boundaries.add((Object[])call.getRawArguments()[1]);return switch(queries.size()){case 1,4->rejected;case 2->List.of(Map.of("run_id",good,"completed_at",at));default->List.of();};});
        doAnswer(call->{if(!good.equals(call.getArgument(1)))throw new IllegalStateException("Synthetic immutable rejection");return null;}).when(service).index(eq(user),any(UUID.class));
        for(int i=0;i<4;i++)assertDoesNotThrow(service::indexPending);verify(service).index(user,good);verify(service,times(2)).index(user,new UUID(0,1));assertFalse(queries.get(0).contains(">(?,?)"));assertTrue(queries.get(1).contains(">(?,?)"));assertFalse(queries.get(3).contains(">(?,?)"));assertArrayEquals(new Object[]{user.organizationId(),user.projectId(),at,new UUID(0,20)},boundaries.get(1));
    }
    @Test void rejectedCompletionCannotStarveLaterValidRecords(){
        var service=mock(SimilarEvidence.class,CALLS_REAL_METHODS);
        var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
        UUID rejected=UUID.randomUUID(),a=UUID.randomUUID(),b=UUID.randomUUID();var accepted=new ArrayList<UUID>();
        doAnswer(call->{UUID id=call.getArgument(1);if(id.equals(rejected))throw new IllegalStateException("Synthetic feature refusal");accepted.add(id);return null;}).when(service).index(eq(user),any(UUID.class));
        assertDoesNotThrow(()->service.indexRows(user,List.of(Map.of("run_id",rejected),Map.of("run_id",a),Map.of("run_id",b))));
        assertEquals(List.of(a,b),accepted);verify(service).index(user,rejected);
    }
    @Test void oversizedBatchCannotStartUnboundedRemoteWork(){
        var service=mock(SimilarEvidence.class,CALLS_REAL_METHODS);
        var rows=new ArrayList<Map<String,Object>>();for(int i=0;i<21;i++)rows.add(Map.of("run_id",UUID.randomUUID()));
        assertThrows(IllegalArgumentException.class,()->service.indexRows(null,rows));verify(service,never()).index(any(),any());
    }
}
