variable "role_name" {
  type        = string
  description = "IAM role name for the Step Functions state machine."
}

variable "lambda_arns" {
  type        = list(string)
  description = "Lambda ARNs the state machine can invoke."
  default     = []
}

variable "event_bus_arn" {
  type        = string
  description = "EventBridge bus ARN."
}

variable "shipping_queue_arn" {
  type        = string
  description = "Shipping queue ARN."
}

variable "notification_queue_arn" {
  type        = string
  description = "Notification queue ARN."
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Tags applied to IAM resources."
}
