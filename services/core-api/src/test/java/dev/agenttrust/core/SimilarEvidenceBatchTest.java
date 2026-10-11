package dev.agenttrust.core;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class SimilarEvidenceBatchTest {
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
