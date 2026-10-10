package agenttrust.release
import rego.v1

default outcome := "inconclusive"

valid_scope if {
    every value in [input.runId, input.organizationId, input.projectId] {
        is_string(value)
        regex.match(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`, value)
    }
    is_boolean(input.approvalRequired)
    input.state in {"queued", "succeeded", "failed"}
    input.evaluationDecision in {"pass", "block", "inconclusive"}
    input.latestReview in {"", "approved", "rejected"}
    is_array(input.rules)
    count(input.rules) > 0
    count(input.rules) <= 100
    every rule in input.rules {
        is_boolean(rule.required)
        rule.status in {"pass", "fail", "inconclusive"}
    }
}

required_failure if {
    some rule in input.rules
    rule.required
    rule.status == "fail"
}

required_all_pass if {
    count([rule | some rule in input.rules; rule.required]) > 0
    count([rule | some rule in input.rules; rule.required; rule.status != "pass"]) == 0
}

current_approval if {
    input.latestReview == "approved"
    input.reviewPolicyVersion == data.agenttrust.policy.version
    input.reviewPolicyDigest == data.agenttrust.policy.digest
}

outcome := "block" if {
    valid_scope
    input.state == "succeeded"
    input.evaluationDecision == "block"
} else := "block" if {
    valid_scope
    input.state == "succeeded"
    required_failure
} else := "block" if {
    valid_scope
    input.evaluationDecision == "pass"
    input.latestReview == "rejected"
} else := "pass" if {
    valid_scope
    input.state == "succeeded"
    input.evaluationDecision == "pass"
    required_all_pass
    input.latestReview != "rejected"
    input.approvalRequired == false
} else := "pass" if {
    valid_scope
    input.state == "succeeded"
    input.evaluationDecision == "pass"
    required_all_pass
    input.approvalRequired
    current_approval
}

reasons := {"pass": "Evaluation and current review permit the synthetic release.", "block": "A required rule or current review blocks release.", "inconclusive": "Complete successful evidence and current approval are required."}
decision := {
    "decision": outcome,
    "deploymentAllowed": outcome == "pass",
    "reason": reasons[outcome],
    "currentReviewRequired": input.approvalRequired,
    "policyVersion": data.agenttrust.policy.version,
    "policyDigest": data.agenttrust.policy.digest,
    "runId": input.runId,
    "organizationId": input.organizationId,
    "projectId": input.projectId,
}
