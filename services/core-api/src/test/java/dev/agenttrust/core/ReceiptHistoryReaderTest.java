package dev.agenttrust.core;
import java.util.*;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class ReceiptHistoryReaderTest {
 final RunService runs=mock(RunService.class);final JdbcTemplate jdbc=mock(JdbcTemplate.class);final ReceiptHistoryReader reader=new ReceiptHistoryReader(runs,jdbc);
 final DemoUser user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");final UUID campaign=UUID.randomUUID();
 ReceiptHistoryReader.Entry entry(int n){return new ReceiptHistoryReader.Entry(new UUID(0,n),campaign,"a".repeat(64),Instant.parse("2026-11-12T00:00:00.123456Z"));}
 @SuppressWarnings("unchecked") void result(List<ReceiptHistoryReader.Entry> rows){when(runs.scoped(eq(user),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());doReturn(rows).when(jdbc).query(anyString(),any(RowMapper.class),any(Object[].class));}
 @Test void projectMetadataPageUsesTwentySixLookaheadAndExactLastVisibleCursor(){var rows=new ArrayList<ReceiptHistoryReader.Entry>();for(int n=30;n>4;n--)rows.add(entry(n));result(rows);var value=reader.page(user,null,null);assertEquals(25,value.entries().size());assertEquals(entry(6),value.entries().getLast());assertEquals(new ReceiptHistoryCursor(user.organizationId(),user.projectId(),null,entry(6).createdAt(),entry(6).id()),ReceiptHistoryCursor.decode(value.nextCursor(),user,null));assertFalse(value.signatureVerificationPerformed());assertFalse(value.deploymentAuthority());verify(runs).scoped(eq(user),any());var sql=org.mockito.ArgumentCaptor.forClass(String.class);verify(jdbc).query(sql.capture(),any(RowMapper.class),eq(user.organizationId()),eq(user.projectId()));assertTrue(sql.getValue().contains("SELECT id,campaign_id,key_id,created_at"));assertTrue(sql.getValue().contains("organization_id=? AND project_id=?"));assertTrue(sql.getValue().endsWith("ORDER BY created_at DESC,id DESC LIMIT 26"));assertFalse(sql.getValue().contains("payload"));assertFalse(sql.getValue().contains("signature"));verifyNoMoreInteractions(jdbc);}
 @Test void filteredNextPageKeepsMicrosecondsAndIdBoundary(){result(List.of(entry(5)));var boundary=new ReceiptHistoryCursor(user.organizationId(),user.projectId(),campaign,entry(6).createdAt(),entry(6).id());var page=reader.page(user,campaign,boundary.encode());assertNull(page.nextCursor());assertEquals(campaign,page.campaignId());var sql=org.mockito.ArgumentCaptor.forClass(String.class);verify(jdbc).query(sql.capture(),any(RowMapper.class),eq(user.organizationId()),eq(user.projectId()),eq(campaign),eq(Timestamp.from(boundary.createdAt())),eq(boundary.id()));assertTrue(sql.getValue().contains("AND campaign_id=? AND (created_at,id)<(?,?)"));}
 @Test void foreignOrChangedFilterCursorIsRejectedBeforeDatabase(){var boundary=new ReceiptHistoryCursor(user.organizationId(),user.projectId(),campaign,entry(6).createdAt(),entry(6).id()).encode();assertEquals(400,assertThrows(ResponseStatusException.class,()->reader.page(user,null,boundary)).getStatusCode().value());assertEquals(401,assertThrows(ResponseStatusException.class,()->reader.page(null,null,null)).getStatusCode().value());verifyNoInteractions(runs,jdbc);}
 @Test void emptyPageDoesNotInventSignatureVerificationAndInvalidKeyCannotBeSerialized(){result(List.of());var value=reader.page(user,null,null);assertTrue(value.entries().isEmpty());assertNull(value.nextCursor());assertThrows(IllegalStateException.class,()->new ReceiptHistoryReader.Entry(UUID.randomUUID(),campaign,"bad",Instant.now()));}
}
