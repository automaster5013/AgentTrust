package agenttrust.release_test
import rego.v1

lifecycle_base := object.union(base,{"agentVersionId":base.runId,"datasetVersionId":base.runId,"agentContentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","datasetContentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
lifecycle_input(states) := object.union(lifecycle_base,{"versionLifecycle":lifecycle_for(states),"releaseRequirements":requirements}) if {
    count(states) == 4
    requirements := {"enabled":true,"evidenceMaxAgeSeconds":3600,"candidateCreatedAtEpochMillis":1999999999990,"baselineCreatedAtEpochMillis":1999999999980,"baselineAgentVersionId":base.runId,"baselineAgentContentSha256":lifecycle_base.agentContentSha256,"comparison":{"status":"no-regression","deploymentAuthority":false}}
} else := object.union(lifecycle_base,{"versionLifecycle":lifecycle_for(states)})

lifecycle_for(states) := {"contract":"campaign-version-lifecycle-v1","campaignId":base.runId,"organizationId":base.organizationId,"projectId":base.projectId,"deploymentAuthority":false,"versions":entries} if {
    entries := [{"contract":"version-lifecycle-v1","kind":["agents","datasets"][i % 2],"versionId":base.runId,"organizationId":base.organizationId,"projectId":base.projectId,"contentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","state":state,"deploymentAuthority":false} | some i, state in states]
}

test_active_version_lifecycle_permits_original_valid_release if {
    lifecycle := lifecycle_for(["active","active"])
    data.agenttrust.release.decision.deploymentAllowed with input as object.union(lifecycle_base,{"versionLifecycle":lifecycle})
}
test_retired_candidate_and_baseline_cannot_be_overridden_by_approval if {
    every states in [
        ["retired","active"],
        ["active","retired"],
        ["active","active","retired","active"],
        ["active","active","active","retired"]
    ] {
        not data.agenttrust.release.decision.deploymentAllowed with input as lifecycle_input(states)
    }
}

test_lifecycle_cannot_cross_organization_or_project if {
    every key in ["organizationId", "projectId"] {
        altered := object.union(lifecycle_for(["active","active"]), {key:base.runId})
        not data.agenttrust.release.decision.deploymentAllowed with input as object.union(lifecycle_base,{"versionLifecycle":altered})
    }
}
test_malformed_lifecycle_refuses_release if {
    every lifecycle in [true,{}, {"contract":"unknown","versions":[{"state":"active"},{"state":"active"}]}, {"contract":"campaign-version-lifecycle-v1","versions":[]}] {
        not data.agenttrust.release.decision.deploymentAllowed with input as object.union(lifecycle_base,{"versionLifecycle":lifecycle})
    }
}

test_baseline_lifecycle_requires_all_four_bound_versions if {
    valid := lifecycle_input(["active","active","active","active"])
    data.agenttrust.release.decision.deploymentAllowed with input as valid
    altered := object.union(valid,{"versionLifecycle":lifecycle_for(["active","active"])})
    not data.agenttrust.release.decision.deploymentAllowed with input as altered
}

test_required_failure_remains_block_when_a_version_is_retired if {
    request := object.union(lifecycle_input(["retired","active"]),{"evaluationDecision":"block","rules":[{"required":true,"status":"fail"}]})
    result := data.agenttrust.release.decision with input as request
    result.decision == "block"
    not result.deploymentAllowed
}
