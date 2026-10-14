package dev.agenttrust.core;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class RunReviewPageTest {
 private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
 private final UUID run=UUID.randomUUID();
 private final DemoUser user=new DemoUser("viewer","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 private final RunService service=new RunService(jdbc,null,null,null){@Override <T>T scoped(DemoUser user,Supplier<T> action){return action.get();}};
 private void admission(){when(jdbc.queryForList("SELECT id FROM stack_runs WHERE id=? AND organization_id=? AND project_id=?",run,user.organizationId(),user.projectId())).thenReturn(List.of(Map.of("id",run)));}
 @Test void lookaheadAndFinalPageNeverRepeatEarlierReviewRows(){admission();var all=new ArrayList<Map<String,Object>>();for(long sequence=101;sequence>=51;sequence--)all.add(Map.of("review_sequence",sequence));when(jdbc.queryForList(startsWith("SELECT id,actor_id"),eq(run),eq(user.organizationId()),eq(user.projectId()),eq(Long.MAX_VALUE))).thenReturn(all);when(jdbc.queryForList(startsWith("SELECT id,actor_id"),eq(run),eq(user.organizationId()),eq(user.projectId()),eq(52L))).thenReturn(List.of(Map.of("review_sequence",51L)));var first=service.reviewHistoryPage(user,run,null);assertEquals(50,((List<?>)first.get("entries")).size());assertEquals(run,first.get("runId"));String cursor=(String)first.get("nextCursor");assertEquals(52,RunReviewCursor.decode(cursor,user,run).sequence());var older=service.reviewHistoryPage(user,run,cursor);assertEquals(List.of(Map.of("review_sequence",51L)),older.get("entries"));assertNull(older.get("nextCursor"));assertEquals(false,older.get("deploymentAuthority"));verify(jdbc).queryForList(contains("review_sequence<? ORDER BY review_sequence DESC LIMIT 51"),eq(run),eq(user.organizationId()),eq(user.projectId()),eq(52L));}
 @Test void exactlyFiftyAndEmptyPagesDoNotInventMoreHistory(){admission();for(int count:new int[]{0,50}){var rows=new ArrayList<Map<String,Object>>();for(long sequence=count;sequence>0;sequence--)rows.add(Map.of("review_sequence",sequence));when(jdbc.queryForList(startsWith("SELECT id,actor_id"),eq(run),eq(user.organizationId()),eq(user.projectId()),eq(Long.MAX_VALUE))).thenReturn(rows);var frame=service.reviewHistoryPage(user,run,null);assertNull(frame.get("nextCursor"));assertEquals(count,((List<?>)frame.get("entries")).size());}}
 @Test void invalidBoundaryOrMissingRunNeverReadsReviewContent(){assertThrows(IllegalArgumentException.class,()->service.reviewHistoryPage(user,run,new CampaignReviewCursor(user.organizationId(),user.projectId(),run,50).encode()));verifyNoInteractions(jdbc);assertThrows(ResponseStatusException.class,()->service.reviewHistoryPage(user,run,null));verify(jdbc,never()).queryForList(startsWith("SELECT id,actor_id"),any(),any(),any(),any());}
}
