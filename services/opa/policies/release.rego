package agenttrust.release
import rego.v1

default outcome := "inconclusive"

valid_scope if {
    every value in [input.runId, input.organizationId, input.projectId] {
        is_string(value)
        regex.match(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`, value)
    }
    valid_epoch_millis(input.nowEpochMillis)
    is_boolean(input.approvalRequired)
    valid_release_requirements
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

release_requirements := object.get(input, "releaseRequirements", {"enabled": false})

active_version_lifecycle if {
    object.get(input, "versionLifecycle", null) == null
} else if {
    lifecycle := input.versionLifecycle
    lifecycle.contract == "campaign-version-lifecycle-v1"
    count(lifecycle) == 6
    lifecycle.campaignId == input.runId
    lifecycle.organizationId == input.organizationId
    lifecycle.projectId == input.projectId
    lifecycle.deploymentAuthority == false
    is_array(lifecycle.versions)
    count(lifecycle.versions) in {2, 4}
    count(lifecycle.versions) == lifecycle_expected_count
    every index, version in lifecycle.versions {
        count(version) == 8
        version.contract == "version-lifecycle-v1"
        version.organizationId == input.organizationId
        version.projectId == input.projectId
        version.deploymentAuthority == false
        version.kind == ["agents", "datasets"][index % 2]
        regex.match(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`, version.versionId)
        regex.match(`^[a-f0-9]{64}$`, version.contentSha256)
        version.state == "active"
        version.versionId == lifecycle_expected_id(index)
        version.contentSha256 == lifecycle_expected_hash(index)
    }
}

lifecycle_expected_count := 4 if {release_requirements.enabled == true} else := 2
lifecycle_expected_id(index) := release_requirements.baselineAgentVersionId if {index == 2} else := input.agentVersionId if {index % 2 == 0} else := input.datasetVersionId
lifecycle_expected_hash(index) := release_requirements.baselineAgentContentSha256 if {index == 2} else := input.agentContentSha256 if {index % 2 == 0} else := input.datasetContentSha256

valid_release_requirements if {
    is_object(release_requirements)
    release_requirements.enabled == false
} else if {
    is_object(release_requirements)
    release_requirements.enabled == true
    is_number(release_requirements.evidenceMaxAgeSeconds)
    release_requirements.evidenceMaxAgeSeconds == floor(release_requirements.evidenceMaxAgeSeconds)
    release_requirements.evidenceMaxAgeSeconds >= 60
    release_requirements.evidenceMaxAgeSeconds <= 86400
    valid_epoch_millis(release_requirements.candidateCreatedAtEpochMillis)
    valid_epoch_millis(release_requirements.baselineCreatedAtEpochMillis)
    release_requirements.baselineCreatedAtEpochMillis <= release_requirements.candidateCreatedAtEpochMillis
    release_requirements.comparison.status in {"no-regression", "regression", "inconclusive"}
    release_requirements.comparison.deploymentAuthority == false
}

release_evidence_current if {
    input.nowEpochMillis >= release_requirements.candidateCreatedAtEpochMillis
    input.nowEpochMillis >= release_requirements.baselineCreatedAtEpochMillis
    input.nowEpochMillis - release_requirements.candidateCreatedAtEpochMillis < release_requirements.evidenceMaxAgeSeconds * 1000
    input.nowEpochMillis - release_requirements.baselineCreatedAtEpochMillis < release_requirements.evidenceMaxAgeSeconds * 1000
}

release_requirements_pass if {
    release_requirements.enabled == false
} else if {
    release_requirements.enabled == true
    release_requirements.comparison.status == "no-regression"
    release_evidence_current
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

valid_epoch_millis(value) if {
    is_number(value)
    value >= 1
    value <= 9007199254740991
    value == floor(value)
}

approval_time_current if {
    valid_epoch_millis(input.reviewCreatedAtEpochMillis)
    input.nowEpochMillis >= input.reviewCreatedAtEpochMillis
    input.nowEpochMillis - input.reviewCreatedAtEpochMillis < 3600000
}

current_approval if {
    input.latestReview == "approved"
    approval_time_current
    input.reviewPolicyVersion == data.agenttrust.policy.version
    input.reviewPolicyDigest == data.agenttrust.policy.digest
}

outcome := "block" if {
    valid_scope
    input.state == "succeeded"
    input.evaluationDecision == "block"
} else := "block" if {
    valid_scope
    release_requirements.enabled == true
    input.state == "succeeded"
    release_requirements.comparison.status == "regression"
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
    active_version_lifecycle
    input.state == "succeeded"
    input.evaluationDecision == "pass"
    required_all_pass
    input.latestReview != "rejected"
    input.approvalRequired == false
    release_requirements_pass
} else := "pass" if {
    valid_scope
    active_version_lifecycle
    input.state == "succeeded"
    input.evaluationDecision == "pass"
    required_all_pass
    input.approvalRequired
    current_approval
    release_requirements_pass
}

reasons := {"pass": "Evaluation and current review permit the synthetic release.", "block": "A required rule or current review blocks release.", "inconclusive": "Complete successful evidence and current approval are required."}
reason := "A candidate or release baseline version has been retired; register an active replacement version." if {
    outcome == "inconclusive"
    some version in input.versionLifecycle.versions
    version.state == "retired"
} else := "The immutable release baseline or evaluation evidence is unresolved, expired, or future-dated." if {
    outcome == "inconclusive"
    valid_scope
    release_requirements.enabled == true
    not release_requirements_pass
} else := "Administrator approval has expired or has an invalid creation time; a fresh approval is required." if {
    outcome == "inconclusive"
    valid_scope
    input.state == "succeeded"
    input.evaluationDecision == "pass"
    required_all_pass
    input.approvalRequired
    input.latestReview == "approved"
    input.reviewPolicyVersion == data.agenttrust.policy.version
    input.reviewPolicyDigest == data.agenttrust.policy.digest
    not approval_time_current
} else := reasons[outcome]
decision := {
    "decision": outcome,
    "deploymentAllowed": outcome == "pass",
    "reason": reason,
    "currentReviewRequired": input.approvalRequired,
    "policyVersion": data.agenttrust.policy.version,
    "policyDigest": data.agenttrust.policy.digest,
    "runId": input.runId,
    "organizationId": input.organizationId,
    "projectId": input.projectId,
}
