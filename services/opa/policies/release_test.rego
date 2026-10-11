package agenttrust.release_test
import rego.v1

base := {"nowEpochMillis":2000000000000,"reviewCreatedAtEpochMillis":1999999999999,"runId":"11111111-1111-4111-8111-111111111111", "organizationId":"22222222-2222-4222-8222-222222222222", "projectId":"33333333-3333-4333-8333-333333333333", "state":"succeeded", "evaluationDecision":"pass", "approvalRequired":true, "latestReview":"approved", "reviewPolicyVersion":data.agenttrust.policy.version,"reviewPolicyDigest":data.agenttrust.policy.digest, "rules":[{"required":true,"status":"pass"}]}

test_approved_complete_pass if {data.agenttrust.release.decision.deploymentAllowed with input as base}
test_required_failure_blocks if {
    result := data.agenttrust.release.decision with input as object.union(base,{"rules":[{"required":true,"status":"fail"}]})
    result.decision == "block"
    not result.deploymentAllowed
}
test_missing_evidence_inconclusive if {
    result := data.agenttrust.release.decision with input as object.union(base,{"rules":[{"required":true,"status":"inconclusive"}]})
    result.decision == "inconclusive"
    not result.deploymentAllowed
}
test_optional_rules_cannot_establish_pass if {
    not data.agenttrust.release.decision.deploymentAllowed with input as object.union(base,{"rules":[{"required":false,"status":"pass"}]})
}
test_rejection_blocks_without_approval_requirement if {
    result := data.agenttrust.release.decision with input as object.union(base,{"approvalRequired":false,"latestReview":"rejected"})
    result.decision == "block"
    not result.deploymentAllowed
}
test_missing_approval_refused if {not data.agenttrust.release.decision.deploymentAllowed with input as object.union(base,{"latestReview":""})}
test_old_policy_approval_refused if {not data.agenttrust.release.decision.deploymentAllowed with input as object.union(base,{"reviewPolicyDigest":"sha256:outdated"})}
test_queued_and_failed_refused if {
    every state in ["queued","failed"] {
        not data.agenttrust.release.decision.deploymentAllowed with input as object.union(base,{"state":state})
    }
}
test_invalid_scope_refused if {not data.agenttrust.release.decision.deploymentAllowed with input as object.union(base,{"organizationId":"foreign"})}
test_boolean_string_refused if {not data.agenttrust.release.decision.deploymentAllowed with input as object.union(base,{"approvalRequired":"false"})}
test_authz_rejects_policy_writes_even_with_token if {
    not data.system.authz.allow with input as {"method":"PUT","path":["v1","policies","release"],"identity":"synthetic-token"} with data.stack_auth.token as "synthetic-token"
}

test_approval_deadline_is_exclusive if {
    data.agenttrust.release.decision.deploymentAllowed with input as object.union(base,{"reviewCreatedAtEpochMillis":1999996400001})
    not data.agenttrust.release.decision.deploymentAllowed with input as object.union(base,{"reviewCreatedAtEpochMillis":1999996400000})
    result := data.agenttrust.release.decision with input as object.union(base,{"reviewCreatedAtEpochMillis":1999996400000})
    contains(result.reason,"fresh approval")
}

test_invalid_or_expired_approval_times_refused if {
    every timestamp in [1999996399999,2000000000001,0,-1,"1999999999999",1999999999999.5,null,9007199254740992] {
        result := data.agenttrust.release.decision with input as object.union(base,{"reviewCreatedAtEpochMillis":timestamp})
        result.decision == "inconclusive"
        not result.deploymentAllowed
    }
    not data.agenttrust.release.decision.deploymentAllowed with input as object.remove(base,["reviewCreatedAtEpochMillis"])
}

test_invalid_trusted_clock_refused if {
    every timestamp in [0,-1,"2000000000000",2000000000000.5,null,9007199254740992] {
        not data.agenttrust.release.decision.deploymentAllowed with input as object.union(base,{"nowEpochMillis":timestamp})
    }
}

test_old_rejection_still_blocks if {
    result := data.agenttrust.release.decision with input as object.union(base,{"reviewCreatedAtEpochMillis":1,"latestReview":"rejected","approvalRequired":false})
    result.decision == "block"
}
