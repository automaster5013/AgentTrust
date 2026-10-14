package dev.agenttrust.core;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CampaignReviewPageTest {
 @Test void lookaheadIsExcludedAndNextQueryUsesLastReturnedSequence(){
  var runs=mock(RunService.class);var jdbc=mock(JdbcTemplate.class);UUID org=UUID.randomUUID(),project=UUID.randomUUID(),campaign=UUID.randomUUID();var user=new DemoUser("viewer","unused",org,project,UUID.randomUUID(),"viewer");
  when(runs.scoped(eq(user),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());
  when(jdbc.queryForList(startsWith("SELECT id,organization_id"),eq(campaign),eq(org),eq(project))).thenReturn(List.of(Map.of("id",campaign)));
  var all=new ArrayList<Map<String,Object>>();for(long sequence=101;sequence>=51;sequence--)all.add(Map.of("review_sequence",sequence));
  when(jdbc.queryForList(startsWith("SELECT id,decision"),eq(campaign),eq(org),eq(project),eq(Long.MAX_VALUE))).thenReturn(all);
  when(jdbc.queryForList(startsWith("SELECT id,decision"),eq(campaign),eq(org),eq(project),eq(52L))).thenReturn(List.of(Map.of("review_sequence",51L)));
  var service=new CampaignService(runs,null,jdbc,null,null,null);var first=service.reviewHistoryPage(user,campaign,null);var entries=(List<?>)first.get("entries");assertEquals(50,entries.size());assertEquals(52L,((Map<?,?>)entries.getLast()).get("review_sequence"));String token=(String)first.get("nextCursor");assertEquals(52,CampaignReviewCursor.decode(token,user,campaign).sequence());var next=service.reviewHistoryPage(user,campaign,token);assertEquals(List.of(Map.of("review_sequence",51L)),next.get("entries"));assertNull(next.get("nextCursor"));assertEquals(false,next.get("deploymentAuthority"));
  verify(jdbc).queryForList(contains("review_sequence<? ORDER BY review_sequence DESC LIMIT 51"),eq(campaign),eq(org),eq(project),eq(52L));verify(jdbc,times(2)).queryForList(startsWith("SELECT id,organization_id"),eq(campaign),eq(org),eq(project));verify(jdbc).queryForList(startsWith("SELECT id,decision"),eq(campaign),eq(org),eq(project),eq(Long.MAX_VALUE));verifyNoMoreInteractions(jdbc);
 }
 @Test void missingCampaignAndInvalidCursorNeverReadReviewRows(){
  var runs=mock(RunService.class);var jdbc=mock(JdbcTemplate.class);var user=new DemoUser("viewer","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");UUID campaign=UUID.randomUUID();when(runs.scoped(eq(user),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());var service=new CampaignService(runs,null,jdbc,null,null,null);assertThrows(IllegalArgumentException.class,()->service.reviewHistoryPage(user,campaign,"bad"));verifyNoInteractions(jdbc);assertThrows(ResponseStatusException.class,()->service.reviewHistoryPage(user,campaign,null));verify(jdbc).queryForList(startsWith("SELECT id,organization_id"),eq(campaign),eq(user.organizationId()),eq(user.projectId()));verifyNoMoreInteractions(jdbc);
 }
}
