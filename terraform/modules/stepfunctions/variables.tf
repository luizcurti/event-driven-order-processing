variable "name" {
  type        = string
  description = "Step Functions state machine name."
}

variable "role_arn" {
  type        = string
  description = "IAM role ARN used by the state machine."
}

variable "definition" {
  type        = string
  description = "ASL definition string."
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Common tags."
}