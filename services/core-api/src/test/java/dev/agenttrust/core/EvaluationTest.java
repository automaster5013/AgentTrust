package dev.agenttrust.core;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class EvaluationTest {
    @Test void requiredFailureBlocksAndMissingOrErrorNeverAllow() {
        assertEquals("pass",Evaluation.evaluate("pass").decision());
        assertEquals("block",Evaluation.evaluate("block").decision());
        assertEquals("inconclusive",Evaluation.evaluate("missing_evidence").decision());
        assertEquals("failed",Evaluation.evaluate("error").state());
        for(var scenario:new String[]{"block","missing_evidence","error"}) assertFalse(Evaluation.gate(Evaluation.evaluate(scenario).decision(),true,"approved").deploymentAllowed());
    }
    @Test void approvalIsCurrentAndRejectionRevokes() {
        assertFalse(Evaluation.gate("pass",true,null).deploymentAllowed());
        assertTrue(Evaluation.gate("pass",true,"approved").deploymentAllowed());
        assertFalse(Evaluation.gate("pass",true,"rejected").deploymentAllowed());
        assertFalse(Evaluation.gate("pass",false,"rejected").deploymentAllowed());
        assertFalse(Evaluation.gate("pass",true,"approved").signed());
    }
    @Test void unknownSyntheticScenariosAreRefused() {assertThrows(IllegalArgumentException.class,()->Evaluation.evaluate("external-code"));}
}
