package dev.agenttrust.core;
import java.time.Instant;import java.util.*;import java.util.function.Supplier;import org.junit.jupiter.api.Test;import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.jdbc.core.RowMapper;import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;
class AuditPeriodReaderTest {
 private final DemoUser user=new DemoUser("viewer","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 @Test void changedPeriodOrOutsideBoundaryCannotOpenDatabaseScope(){
  var runs=mock(RunService.class);var jdbc=mock(JdbcTemplate.class);var reader=new AuditReader(runs,jdbc);var p=AuditPeriod.parse("2026-11-03","2026-11-03","all","all","all");var boundary=new AuditCursor(user.organizationId(),user.projectId(),Instant.parse("2026-11-03T00:00:00Z"),UUID.randomUUID());String token=AuditPeriodCursor.encode(boundary,p);
  assertThrows(IllegalArgumentException.class,()->reader.periodSearch(user,AuditPeriod.parse("2026-11-02","2026-11-03","all","all","all"),token));
  var outside=new AuditCursor(user.organizationId(),user.projectId(),Instant.parse("2026-11-04T00:00:00Z"),UUID.randomUUID());assertThrows(IllegalArgumentException.class,()->reader.periodSearch(user,p,AuditPeriodCursor.encode(outside,p)));verifyNoInteractions(runs,jdbc);
 }
 @Test void utcEndIsExclusiveAndBothTimesAreBoundWithTenantAndActor(){
  var runs=mock(RunService.class);when(runs.scoped(eq(user),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());var argsSeen=new ArrayList<List<Object>>();var sqlSeen=new ArrayList<String>();
  var jdbc=new JdbcTemplate(){@Override public <T> List<T> query(String sql,RowMapper<T> mapper,Object... args){sqlSeen.add(sql);argsSeen.add(Arrays.asList(args));return List.of();}};
  var p=AuditPeriod.parse("2026-11-03","2026-11-03",user.actorId().toString(),"review.approved","all");var reader=new AuditReader(runs,jdbc);var page=reader.periodSearch(user,p,null);
  assertEquals(List.of(user.organizationId(),user.projectId(),"review.approved",user.actorId(),java.sql.Timestamp.from(Instant.parse("2026-11-03T00:00:00Z")),java.sql.Timestamp.from(Instant.parse("2026-11-04T00:00:00Z"))),argsSeen.getFirst());assertTrue(sqlSeen.getFirst().contains("created_at>=? AND created_at<?"));assertEquals("2026-11-03",page.startDay());assertFalse(page.deploymentAuthority());verify(runs).scoped(eq(user),any());verifyNoMoreInteractions(runs);
 }
}
