package dev.agenttrust.core;
import java.time.Instant;
import java.util.ArrayList;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CampaignHistorySearchReaderTest {
 @Test void queryBindsScopeAllConditionsAndLookaheadBeforeIssuingLastVisibleBoundary(){
  var org=UUID.randomUUID();var project=UUID.randomUUID();var dataset=UUID.randomUUID();var agent=UUID.randomUUID();
  var user=new DemoUser("viewer","unused",org,project,UUID.randomUUID(),"viewer");
  var service=mock(RunService.class);var jdbc=mock(JdbcTemplate.class);
  doAnswer(call->((Supplier<?>)call.getArgument(1)).get()).when(service).scoped(eq(user),any());
  var rows=new ArrayList<CampaignHistoryReader.Entry>();
  for(int i=0;i<26;i++)rows.add(new CampaignHistoryReader.Entry(new UUID(0,30-i),agent,dataset,true,Instant.parse("2026-11-03T00:00:00.123456Z")));
  doAnswer(call->{
   String query=call.getArgument(0);assertTrue(query.contains("WHERE organization_id=? AND project_id=? AND dataset_version_id=? AND requires_approval=? AND agent_version_id=?"));assertTrue(query.endsWith("ORDER BY created_at DESC,id DESC LIMIT 26"));
   assertEquals(org,call.getArgument(2));assertEquals(project,call.getArgument(3));assertEquals(dataset,call.getArgument(4));assertEquals(true,call.getArgument(5));assertEquals(agent,call.getArgument(6));return rows;
  }).when(jdbc).query(anyString(),any(RowMapper.class),any(Object[].class));
  var filters=new CampaignHistoryFilters("required",agent);var result=new CampaignHistoryReader(service,jdbc).search(user,dataset,filters,null);
  assertEquals(25,result.entries().size());assertFalse(result.deploymentAuthority());
  var cursor=CampaignHistorySearchCursor.decode(result.nextCursor(),user,dataset,filters);assertEquals(rows.get(24).id(),cursor.id());assertEquals(rows.get(24).createdAt(),cursor.createdAt());
  verify(service).scoped(eq(user),any());verifyNoMoreInteractions(service);verify(jdbc,never()).update(anyString(),any(Object[].class));
 }
 @Test void invalidScopeBoundaryIsRefusedBeforeAnyDatabaseRead(){
  var service=mock(RunService.class);var jdbc=mock(JdbcTemplate.class);var user=new DemoUser("viewer","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
  var filters=new CampaignHistoryFilters("all",null);var bound=new CampaignHistoryCursor(UUID.randomUUID(),user.projectId(),null,Instant.now(),UUID.randomUUID());
  assertThrows(IllegalArgumentException.class,()->new CampaignHistoryReader(service,jdbc).search(user,null,filters,CampaignHistorySearchCursor.encode(bound,filters)));verifyNoInteractions(service,jdbc);
 }
}
