package dev.agenttrust.core;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Security boundary tests; these do not claim actual PostgreSQL/RLS integration. */
class AuditActorReaderTest {
 private final DemoUser user=new DemoUser("viewer","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 private final AuditFilters filters=AuditFilters.parse("review.approved","all");
 @Test void foreignActorFilterAndTenantBoundariesAreRejectedBeforeOpeningDatabaseScope(){
  var jdbc=mock(JdbcTemplate.class);var runs=mock(RunService.class);var reader=new AuditReader(runs,jdbc);
  var boundary=new AuditCursor(user.organizationId(),user.projectId(),Instant.parse("2026-10-12T09:00:00.123456Z"),UUID.randomUUID());
  String token=AuditActorCursor.encode(boundary,filters,user.actorId());
  assertThrows(IllegalArgumentException.class,()->reader.actorSearch(user,UUID.randomUUID(),filters,token));
  assertThrows(IllegalArgumentException.class,()->reader.actorSearch(user,user.actorId(),AuditFilters.parse("all","all"),token));
  var foreign=new DemoUser("foreign","unused",UUID.randomUUID(),user.projectId(),user.actorId(),"admin");
  assertThrows(IllegalArgumentException.class,()->reader.actorSearch(foreign,user.actorId(),filters,token));
  verifyNoInteractions(runs,jdbc);
 }
 @Test void firstAndNextPagesCarryExactScopeAndActorAsBoundParametersWithoutWriting(){
  var runs=mock(RunService.class);when(runs.scoped(eq(user),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());
  List<AuditReader.Entry> rows=new ArrayList<>();for(int i=26;i>0;i--)rows.add(new AuditReader.Entry(new UUID(-1,i),user.actorId(),"review.approved",user.actorId(),Instant.parse("2026-10-12T09:00:00.123456Z")));
  var queries=new ArrayList<String>();var parameters=new ArrayList<List<Object>>();
  var jdbc=new JdbcTemplate(){@Override @SuppressWarnings("unchecked") public <T> List<T> query(String sql,RowMapper<T> mapper,Object... args){queries.add(sql);parameters.add(Arrays.asList(args));return (List<T>)(List<?>)rows;}};
  var reader=new AuditReader(runs,jdbc);var first=reader.actorSearch(user,user.actorId(),filters,null);
  assertEquals(25,first.entries().size());assertEquals(168,first.nextCursor().length());assertEquals(user.actorId(),first.actorId());assertFalse(first.deploymentAuthority());
  var last=first.entries().getLast();var decoded=AuditActorCursor.decode(first.nextCursor(),user,filters,user.actorId());assertEquals(last.id(),decoded.id());assertEquals(last.createdAt(),decoded.createdAt());
  assertEquals(List.of(user.organizationId(),user.projectId(),"review.approved",user.actorId()),parameters.getFirst());
  rows.clear();reader.actorSearch(user,user.actorId(),filters,first.nextCursor());
  assertEquals(6,parameters.getLast().size());assertEquals(java.sql.Timestamp.from(last.createdAt()),parameters.getLast().get(4));assertEquals(last.id(),parameters.getLast().get(5));
  assertTrue(queries.stream().allMatch(sql->sql.startsWith("SELECT ")&&sql.contains("organization_id=? AND project_id=?")&&sql.contains(" AND actor_id=?")&&sql.endsWith("ORDER BY created_at DESC,id DESC LIMIT 26")));
  verify(runs,times(2)).scoped(eq(user),any());verifyNoMoreInteractions(runs);
 }
}
