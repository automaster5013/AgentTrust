package dev.agenttrust.core;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.*;

class PendingWorkspaceScopesTest {
    private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
    private final PendingWorkspaceScopes reader=new PendingWorkspaceScopes(jdbc);
    private static PendingWorkspaceScopes.Scope scope(String organization,String project){return new PendingWorkspaceScopes.Scope(UUID.fromString(organization),UUID.fromString(project));}
    private void page(List<PendingWorkspaceScopes.Scope> rows){when(jdbc.query(any(PreparedStatementCreator.class),org.mockito.ArgumentMatchers.<RowMapper<PendingWorkspaceScopes.Scope>>any())).thenReturn(rows);}
    @Test void readsOnlyTheNarrowFunctionWithTypedCursorAndStatementDeadline() throws Exception {
        var cursor=scope("70000000-0000-0000-0000-000000000001","10000000-0000-0000-0000-000000000001");page(List.of());assertTrue(reader.after(cursor).isEmpty());
        var creator=ArgumentCaptor.forClass(PreparedStatementCreator.class);verify(jdbc).query(creator.capture(),org.mockito.ArgumentMatchers.<RowMapper<PendingWorkspaceScopes.Scope>>any());
        var connection=mock(Connection.class);var statement=mock(PreparedStatement.class);when(connection.prepareStatement(anyString())).thenReturn(statement);
        assertSame(statement,creator.getValue().createPreparedStatement(connection));
        verify(connection).prepareStatement("SELECT organization_id,project_id FROM public.stack_pending_workspaces(?::uuid,?::uuid)");
        verify(statement).setQueryTimeout(2);verify(statement).setObject(1,cursor.organizationId(),Types.OTHER);verify(statement).setObject(2,cursor.projectId(),Types.OTHER);
    }
    @Test void postgresUnsignedUuidBoundaryIsAcceptedAndResultsAreImmutable(){
        var low=scope("7fffffff-ffff-ffff-ffff-ffffffffffff","10000000-0000-0000-0000-000000000001");var high=scope("80000000-0000-0000-0000-000000000000","10000000-0000-0000-0000-000000000001");
        assertTrue(low.organizationId().compareTo(high.organizationId())>0);assertTrue(PendingWorkspaceScopes.compare(low,high)<0);
        page(List.of(high));var result=reader.after(low);assertEquals(List.of(high),result);assertThrows(UnsupportedOperationException.class,()->result.add(low));
    }
    @Test void duplicateDescendingReplayedOrOversizedPagesAreRefused(){
        var low=scope("10000000-0000-0000-0000-000000000000","10000000-0000-0000-0000-000000000001");var high=scope("20000000-0000-0000-0000-000000000000","10000000-0000-0000-0000-000000000001");
        for(var rows:List.of(List.of(low,low),List.of(high,low),Collections.nCopies(9,high))){page(rows);assertThrows(IllegalStateException.class,()->reader.after(null));}
        page(List.of(low));assertThrows(IllegalStateException.class,()->reader.after(low));
    }
}
