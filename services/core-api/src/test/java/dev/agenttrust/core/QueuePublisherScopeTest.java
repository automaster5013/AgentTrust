package dev.agenttrust.core;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class QueuePublisherScopeTest {
    private final RunService runs=mock(RunService.class);
    private final PendingWorkspaceScopes scopes=mock(PendingWorkspaceScopes.class);
    private final QueuePublisher publisher=new QueuePublisher(runs,new ObjectMapper(),scopes,"a".repeat(64));
    private static PendingWorkspaceScopes.Scope scope(int number){return new PendingWorkspaceScopes.Scope(new UUID(0,number),new UUID(0,number+100));}
    private static List<Map<String,Object>> expired(int count){var rows=new ArrayList<Map<String,Object>>();for(int i=0;i<count;i++)rows.add(Map.of("id",UUID.randomUUID(),"expired",true,"scenario","pass","provider","synthetic"));return rows;}
    @Test void nonSeededNamespacesAreDispatchedUnderTheirOwnViewerScopeWithoutCredentialFileChanges(){
        var namespace=scope(1);when(scopes.after(null)).thenReturn(List.of(namespace));when(runs.pending(any())).thenReturn(expired(1));publisher.dispatch();
        var actor=ArgumentCaptor.forClass(DemoUser.class);verify(runs).pending(actor.capture());assertEquals(namespace.organizationId(),actor.getValue().organizationId());assertEquals(namespace.projectId(),actor.getValue().projectId());assertEquals("viewer",actor.getValue().role());verify(runs).complete(eq(actor.getValue()),any(),eq("pass"),any(Evaluation.Result.class));
    }
    @Test void perCycleBudgetAdvancesToLaterNamespacesInsteadOfPinningDiscoveryToTheFirstPage(){
        var page=new ArrayList<PendingWorkspaceScopes.Scope>();for(int i=1;i<=8;i++)page.add(scope(i));
        when(scopes.after(null)).thenReturn(page);when(scopes.after(scope(2))).thenReturn(page.subList(2,8));when(runs.pending(any())).thenReturn(expired(20));
        publisher.dispatch();verify(runs,times(40)).complete(any(),any(),eq("pass"),any(Evaluation.Result.class));publisher.dispatch();verify(scopes).after(scope(2));
        var actors=ArgumentCaptor.forClass(DemoUser.class);verify(runs,times(4)).pending(actors.capture());assertEquals(List.of(scope(1).organizationId(),scope(2).organizationId(),scope(3).organizationId(),scope(4).organizationId()),actors.getAllValues().stream().map(DemoUser::organizationId).toList());
    }
    @Test void metadataFailureNeverWidensIntoAnUnscopedPayloadQuery(){when(scopes.after(null)).thenThrow(new IllegalStateException("fixture unavailable"));assertDoesNotThrow(publisher::dispatch);verifyNoInteractions(runs);}
    @Test void oneFailedNamespaceDoesNotPreventAnotherNamespacesDeadlineHandling(){
        when(scopes.after(null)).thenReturn(List.of(scope(1),scope(2)));when(runs.pending(any())).thenAnswer(call->{DemoUser actor=call.getArgument(0);if(actor.organizationId().equals(scope(1).organizationId()))throw new IllegalStateException("fixture unavailable");return expired(1);});
        publisher.dispatch();var actor=ArgumentCaptor.forClass(DemoUser.class);verify(runs).complete(actor.capture(),any(),eq("pass"),any(Evaluation.Result.class));assertEquals(scope(2).organizationId(),actor.getValue().organizationId());
    }
}
