variable "kubeconfig_path" {
  type        = string
  description = "Explicit operator-owned kubeconfig. No cluster is created by this module."
}
variable "kube_context" {
  type        = string
  description = "Explicit local review context; never rely on the current context."
  validation {
    condition     = can(regex("^[A-Za-z0-9._/-]{1,100}$", var.kube_context))
    error_message = "An explicit bounded context name is required."
  }
}
variable "revision" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.revision))
    error_message = "An exact tested Git revision is required."
  }
}
variable "existing_secret" {
  type    = string
  default = "agenttrust-stack-config"
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.existing_secret))
    error_message = "Only an existing Kubernetes secret name is accepted; credentials never enter Terraform values."
  }
}
variable "images" {
  type = map(string)
  validation {
    condition     = toset(keys(var.images)) == toset(["core-api", "ai-worker", "gateway", "console", "opa"]) && alltrue([for name, image in var.images : can(regex("^ghcr\\.io/automaster5013/agenttrust-${name}@sha256:[a-f0-9]{64}$", image))])
    error_message = "Five exact tested application digests are required; mutable tags and external repositories are refused."
  }
}
variable "dependencies" {
  type = object({ namespace = string, postgres = string, nats = string, redis = string, identity = string, objectStore = string })
  validation {
    condition     = var.dependencies.namespace != "agenttrust-review" && can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.dependencies.namespace)) && alltrue([for name, dns in var.dependencies : name == "namespace" || can(regex("^[a-z0-9-]+\\.${var.dependencies.namespace}\\.svc\\.cluster\\.local$", dns))])
    error_message = "Provisioned dependency service DNS must remain in the explicit dependency namespace."
  }
}

variable "install_application" {
  type        = bool
  default     = false
  description = "Explicit second phase after namespace, dependency readiness and secret provisioning. Default creates only isolated namespace/quota."
}
