variable "aws_region" {
  type        = string
  default     = "us-east-1"
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
