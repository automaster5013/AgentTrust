terraform {
  required_version = "= 1.16.5"
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = "= 3.3.0" }
    helm       = { source = "hashicorp/helm", version = "= 3.3.0" }
  }
}

provider "kubernetes" {
  config_path    = var.kubeconfig_path
  config_context = var.kube_context
}
provider "helm" {
  kubernetes = {
    config_path    = var.kubeconfig_path
    config_context = var.kube_context
  }
}

resource "kubernetes_namespace_v1" "review" {
  metadata {
    name = "agenttrust-review"
    labels = {
      "app.kubernetes.io/part-of"                  = "agenttrust-review"
      "pod-security.kubernetes.io/enforce"         = "restricted"
      "pod-security.kubernetes.io/enforce-version" = "v1.34"
    }
  }
  lifecycle { prevent_destroy = true }
}

resource "kubernetes_resource_quota_v1" "review" {
  metadata {
    name      = "agenttrust-review"
    namespace = kubernetes_namespace_v1.review.metadata[0].name
  }
  spec {
    hard = {
      "requests.cpu"           = "2"
      "requests.memory"        = "1Gi"
      "limits.cpu"             = "6"
      "limits.memory"          = "4Gi"
      "pods"                   = "20"
      "services"               = "15"
      "secrets"                = "10"
      "configmaps"             = "10"
      "persistentvolumeclaims" = "0"
    }
  }
}

resource "helm_release" "review" {
  count            = var.install_application ? 1 : 0
  name             = "agenttrust-review"
  namespace        = kubernetes_namespace_v1.review.metadata[0].name
  chart            = "${path.module}/../../../charts/agenttrust-review"
  create_namespace = false
  wait             = true
  timeout          = 600
  max_history      = 5
  values = [jsonencode({
    mode           = "local-review"
    revision       = var.revision
    existingSecret = var.existing_secret
    images         = var.images
    dependencies   = var.dependencies
  })]
  depends_on = [kubernetes_resource_quota_v1.review]
  lifecycle { prevent_destroy = true }
}
