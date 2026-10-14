mock_provider "kubernetes" {}
mock_provider "helm" {}

variables {
  install_application = true
  kubeconfig_path     = "/not-loaded-by-mock-provider"
  kube_context        = "agenttrust-review-fixture"
  revision            = "1111111111111111111111111111111111111111"
  images = {
    core-api         = "ghcr.io/automaster5013/agenttrust-core-api@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    ai-worker        = "ghcr.io/automaster5013/agenttrust-ai-worker@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    gateway          = "ghcr.io/automaster5013/agenttrust-gateway@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    console          = "ghcr.io/automaster5013/agenttrust-console@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    opa              = "ghcr.io/automaster5013/agenttrust-opa@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    quality-verifier = "ghcr.io/automaster5013/agenttrust-quality-verifier@sha256:1111111111111111111111111111111111111111111111111111111111111111"
  }
  dependencies = {
    namespace   = "agenttrust-dependencies"
    postgres    = "postgres.agenttrust-dependencies.svc.cluster.local"
    nats        = "nats.agenttrust-dependencies.svc.cluster.local"
    redis       = "redis.agenttrust-dependencies.svc.cluster.local"
    identity    = "identity.agenttrust-dependencies.svc.cluster.local"
    objectStore = "objects.agenttrust-dependencies.svc.cluster.local"
  }
}

run "review_plan_has_no_plaintext_credentials" {
  command = plan
  assert {
    condition     = kubernetes_namespace_v1.review.metadata[0].name == "agenttrust-review" && kubernetes_namespace_v1.review.metadata[0].labels["pod-security.kubernetes.io/enforce"] == "restricted"
    error_message = "The isolated namespace must enforce restricted pods."
  }
  assert {
    condition     = jsondecode(helm_release.review[0].values[0]).mode == "local-review" && jsondecode(helm_release.review[0].values[0]).existingSecret == "agenttrust-stack-config" && helm_release.review[0].wait && helm_release.review[0].timeout == 600
    error_message = "Review-only configuration, secret references and bounded rollout waiting must remain configured."
  }
  assert {
    condition     = kubernetes_resource_quota_v1.review.spec[0].hard["persistentvolumeclaims"] == "0"
    error_message = "This application module must not create or own dependency data volumes."
  }
}
run "mutable_images_rejected" {
  command = plan
  variables {
    images = { core-api = "ghcr.io/automaster5013/agenttrust-core-api:main", ai-worker = "fixture", gateway = "fixture", console = "fixture", opa = "fixture", quality-verifier = "fixture" }
  }
  expect_failures = [var.images]
}
run "quota_covers_actual_rendered_chart" {
  command = plan
  assert {
    condition     = tonumber(kubernetes_resource_quota_v1.review.spec[0].hard["limits.cpu"]) * 1000 >= jsondecode(file("${path.module}/rendered-resource-budget.json")).limitsCpuMilli && tonumber(kubernetes_resource_quota_v1.review.spec[0].hard["requests.cpu"]) * 1000 >= jsondecode(file("${path.module}/rendered-resource-budget.json")).requestsCpuMilli
    error_message = "The namespace CPU quota must admit all six actual rendered workloads together."
  }
  assert {
    condition     = tonumber(trimsuffix(kubernetes_resource_quota_v1.review.spec[0].hard["limits.memory"], "Gi")) * 1073741824 >= jsondecode(file("${path.module}/rendered-resource-budget.json")).limitsMemoryBytes && tonumber(trimsuffix(kubernetes_resource_quota_v1.review.spec[0].hard["requests.memory"], "Gi")) * 1073741824 >= jsondecode(file("${path.module}/rendered-resource-budget.json")).requestsMemoryBytes
    error_message = "The namespace memory quota must admit the complete rendered workload budget."
  }
}
run "external_dependency_rejected" {
  command = plan
  variables {
    dependencies = { namespace = "agenttrust-dependencies", postgres = "outside.invalid", nats = "nats.agenttrust-dependencies.svc.cluster.local", redis = "redis.agenttrust-dependencies.svc.cluster.local", identity = "identity.agenttrust-dependencies.svc.cluster.local", objectStore = "objects.agenttrust-dependencies.svc.cluster.local" }
  }
  expect_failures = [var.dependencies]
}
run "empty_context_rejected" {
  command = plan
  variables { kube_context = "" }
  expect_failures = [var.kube_context]
}
run "development_signing_history_references_only" {
  command = plan
  variables {
    development_signing = { enabled = true, history_enabled = true }
  }
  assert {
    condition     = jsondecode(helm_release.review[0].values[0]).signing.mode == "local-development" && jsondecode(helm_release.review[0].values[0]).signing.historyEnabled && jsondecode(helm_release.review[0].values[0]).existingSecret == "agenttrust-stack-config"
    error_message = "Development signing and history must pass only flags and the existing secret name into Helm."
  }
}
run "history_without_development_signing_rejected" {
  command = plan
  variables {
    development_signing = { enabled = false, history_enabled = true }
  }
  expect_failures = [var.development_signing]
}
