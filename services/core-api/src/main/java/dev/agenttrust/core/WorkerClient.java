package dev.agenttrust.core;

import java.util.List;

/** Validates authoritative worker evidence before immutable completion. */
public final class WorkerClient {
    static Evaluation.Result validated(Evaluation.Result result) {
        if(result == null || result.executionEngine()==null || !List.of("python-synthetic","python-ollama","python-openai","python-openai-compatible").contains(result.executionEngine()) || !List.of("succeeded", "failed").contains(result.state()) || !List.of("pass", "block", "inconclusive").contains(result.decision()) || result.rules() == null || result.rules().isEmpty() || result.rules().size() > 100) throw new IllegalArgumentException("Invalid worker evidence");
        boolean failed = false, missing = false, required = false;
        for(var rule : result.rules()) {
            if(rule == null || rule.id() == null || rule.id().isBlank() || rule.id().length() > 100 || rule.reason() == null || rule.reason().length() > 500 || !List.of("pass", "fail", "inconclusive").contains(rule.status())) throw new IllegalArgumentException("Invalid worker rule");
            if(rule.required()) {required = true;failed |= rule.status().equals("fail");missing |= rule.status().equals("inconclusive");}
        }
        String expected = result.state().equals("failed") ? "inconclusive" : failed ? "block" : missing || !required ? "inconclusive" : "pass";
        if(!expected.equals(result.decision())) throw new IllegalArgumentException("Contradictory worker verdict");
        return result;
    }
    static String engine(String provider){return "python-"+provider;}
    static Evaluation.Result unavailable() {
        return new Evaluation.Result("failed", "inconclusive", List.of(new Evaluation.Rule("worker-availability", true, "inconclusive", "Python worker response or scoped evidence was unavailable.")), "python-unavailable");
    }
}
