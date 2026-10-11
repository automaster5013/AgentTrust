package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RunCancellationTest {
    private final UUID owner=UUID.randomUUID();
    private DemoUser user(String role,UUID actor){return new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),actor,role);}
    @Test void cancellationIsTerminalInconclusiveAndCannotBeAWorkerCompletion(){
        var result=RunCancellation.result(" Stop the pending evaluation ");assertEquals("failed",result.state());assertEquals("inconclusive",result.decision());assertEquals("java-cancelled",result.executionEngine());assertTrue(result.rules().getFirst().required());assertEquals("inconclusive",result.rules().getFirst().status());
        assertThrows(IllegalArgumentException.class,()->WorkerClient.validated(result));assertTrue(RunCancellation.cancelled(new ObjectMapper().valueToTree(result)));
        assertFalse(RunCancellation.cancelled(new ObjectMapper().valueToTree(Evaluation.evaluate("pass"))));
    }
    @Test void onlyAdministratorOrOwningEditorMayCancel(){
        assertDoesNotThrow(()->RunCancellation.owner(user("admin",UUID.randomUUID()),owner));assertDoesNotThrow(()->RunCancellation.owner(user("editor",owner),owner));
        assertThrows(Exception.class,()->RunCancellation.owner(user("editor",UUID.randomUUID()),owner));assertThrows(Exception.class,()->RunCancellation.owner(user("viewer",owner),owner));
    }
    @Test void reasonIsRequiredAndBounded(){for(String reason:new String[]{null,""," ","a".repeat(201)})assertThrows(Exception.class,()->RunCancellation.result(reason));assertDoesNotThrow(()->RunCancellation.result("a".repeat(200)));}
}
