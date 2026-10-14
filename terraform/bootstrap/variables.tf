variable "aws_region" {
  type        = string
  default     = "eu-west-2"
  description = "AWS region for the state bucket and lock table."
}

variable "state_bucket_name" {
  type        = string
  description = "Globally-unique S3 bucket name for Terraform remote state. Must be set explicitly -- there is no safe generated default since S3 bucket names are unique across all of AWS."
}

variable "lock_table_name" {
  type        = string
  default     = "event-driven-order-processing-tf-locks"
  description = "DynamoDB table name used for Terraform state locking (shared by both dev and prod)."
}

variable "budget_limit_usd" {
  type        = number
  default     = 0
  description = "Monthly AWS cost budget in USD for this account, covering dev and prod combined. Step Functions bills per state transition and Lambda per invocation, so an account-wide guardrail is cheap insurance against a runaway loop or bug. 0 (default) skips creating the budget entirely, so this stack still applies cleanly out of the box."
}

variable "budget_notification_email" {
  type        = string
  default     = ""
  description = "Email notified at 80% actual and 100% forecasted spend against budget_limit_usd. Required when budget_limit_usd > 0."

  validation {
    condition     = var.budget_limit_usd == 0 || var.budget_notification_email != ""
    error_message = "budget_notification_email must be set when budget_limit_usd > 0."
  }
}

variable "manage_apigateway_account" {
  type        = bool
  default     = true
  description = "Set the region's API Gateway CloudWatch logging role (an account/region-wide singleton) from this stack. Set to false when another stack in the same account and region already manages aws_api_gateway_account, so the two don't keep overwriting each other."
}

variable "github_repository" {
  type        = string
  default     = "luizcurti/event-driven-order-processing"
  description = "owner/repo allowed to assume the deploy role via GitHub OIDC."
}

variable "github_owner_id" {
  type        = number
  default     = 9360461
  description = "Numeric GitHub ID of the repository owner, used in GitHub's immutable OIDC subject format (gh api repos/OWNER/REPO --jq .owner.id)."
}

variable "github_repository_id" {
  type        = number
  default     = 1305192869
  description = "Numeric GitHub ID of the repository, used in GitHub's immutable OIDC subject format (gh api repos/OWNER/REPO --jq .id)."
}

variable "github_environments" {
  type        = list(string)
  default     = ["dev"]
  description = "GitHub environments whose jobs may assume the deploy role. Each one maps to terraform/environments/<name>."
}

variable "create_oidc_provider" {
  type        = bool
  default     = true
  description = "Create the token.actions.githubusercontent.com OIDC provider. Set to false if the account already has it (an account can only have one)."
}

variable "project_name" {
  type        = string
  default     = "event-driven-order-processing"
  description = "Must match project_name in terraform/environments/*/variables.tf: the deploy role's permissions are scoped by this prefix."
}
