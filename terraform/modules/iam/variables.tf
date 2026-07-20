variable "project_name" {
  type        = string
  description = "Project name used in IAM resources."
}

variable "orders_table_arn" {
  type        = string
  description = "Orders table ARN."
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

variable "lambda_arns" {
  type        = list(string)
  description = "Lambda ARNs that Step Functions can invoke."
  default     = []
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Tags applied to IAM resources."
}