package dev.agenttrust.core;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class WorkerClientTest {
    @Test void contradictoryEvidenceCannotPass() {
        assertThrows(IllegalArgumentException.class, () -> WorkerClient.validated(new Evaluation.Result("succeeded", "pass", List.of(new Evaluation.Rule("required", true, "fail", "Failure")), "python-synthetic")));
        assertThrows(IllegalArgumentException.class, () -> WorkerClient.validated(new Evaluation.Result("failed", "pass", List.of(new Evaluation.Rule("required", true, "pass", "Output")), "python-synthetic")));
        assertThrows(IllegalArgumentException.class, () -> WorkerClient.validated(new Evaluation.Result("succeeded", "pass", List.of(new Evaluation.Rule("optional", false, "pass", "Optional")), "python-synthetic")));
    }
    @Test void providerEvidenceKeepsRequiredFailureSemantics(){
        for(String engine:List.of("python-ollama","python-openai","python-openai-compatible")){
            assertEquals("block",WorkerClient.validated(new Evaluation.Result("succeeded","block",List.of(new Evaluation.Rule("required",true,"fail","Failure")),engine)).decision());
            assertThrows(IllegalArgumentException.class,()->WorkerClient.validated(new Evaluation.Result("succeeded","pass",List.of(new Evaluation.Rule("required",true,"fail","Failure")),engine)));
        }
        assertThrows(IllegalArgumentException.class,()->WorkerClient.validated(new Evaluation.Result("succeeded","pass",List.of(new Evaluation.Rule("required",true,"pass","Output")),"arbitrary-provider")));
    }
    @Test void transportFailureCannotAllow() {
        var unavailable=WorkerClient.unavailable();
        assertEquals("failed",unavailable.state());assertEquals("inconclusive",unavailable.decision());
        assertFalse(Evaluation.gate(unavailable.decision(),false,"approved").deploymentAllowed());
    }
}
