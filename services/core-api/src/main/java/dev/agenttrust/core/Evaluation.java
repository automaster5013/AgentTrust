package dev.agenttrust.core;

import java.util.List;

/** First Java slice: deterministic synthetic evaluation; Python/provider execution is separate future work. */
public final class Evaluation {
    public record Rule(String id, boolean required, String status, String reason) {}
    public record Result(String state, String decision, List<Rule> rules, String executionEngine) {}
    public static Result evaluate(String scenario) {
        return switch(scenario) {
            case "pass" -> new Result("succeeded","pass",List.of(new Rule("required-output",true,"pass","Synthetic output satisfies the requirement.")),"java-synthetic");
            case "block" -> new Result("succeeded","block",List.of(new Rule("required-output",true,"fail","A required rule failed.")),"java-synthetic");
            case "missing_evidence" -> new Result("succeeded","inconclusive",List.of(new Rule("required-output",true,"inconclusive","Required evidence is missing.")),"java-synthetic");
            case "error" -> new Result("failed","inconclusive",List.of(new Rule("required-output",true,"inconclusive","Synthetic execution failed.")),"java-synthetic");
            default -> throw new IllegalArgumentException("Unsupported synthetic scenario");
        };
    }
    public record Gate(String decision, boolean deploymentAllowed, String reason, boolean signed, boolean currentReviewRequired) {}
    public static Gate gate(String evaluationDecision, boolean approvalRequired, String latestReview) {
        if (!evaluationDecision.equals("pass")) return new Gate(evaluationDecision,false,"Evaluation does not permit release.",false,approvalRequired);
        if ("rejected".equals(latestReview)) return new Gate("block",false,"The latest review rejects release.",false,approvalRequired);
        if (approvalRequired && !"approved".equals(latestReview)) return new Gate("inconclusive",false,"Current administrator approval is required.",false,true);
        return new Gate("pass",true,"Evaluation and current review requirements permit the synthetic release.",false,approvalRequired);
    }
}
