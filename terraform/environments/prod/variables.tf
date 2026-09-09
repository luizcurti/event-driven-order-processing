variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for the environment."
}

variable "project_name" {
  type        = string
  default     = "event-driven-order-processing"
  description = "Project name prefix."
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "Environment name."
}

variable "waf_rate_limit" {
  type        = number
  default     = 5000
  description = "WAF requests per 5-minute period."
}

variable "lambda_reserved_concurrency" {
  type        = number
  default     = 20
  description = "Reserved concurrency applied to every Lambda function, so a bug/loop in any one of them can't consume the account's whole concurrency pool. -1 leaves functions unreserved."
}

variable "api_throttling_rate_limit" {
  type        = number
  default     = 100
  description = "Steady-state requests per second allowed across the API Gateway stage."
}

variable "api_throttling_burst_limit" {
  type        = number
  default     = 200
  description = "Burst capacity (token bucket size) for the API Gateway stage."
}

variable "alarm_notification_email" {
  type        = string
  default     = ""
  description = "Email address subscribed to the CloudWatch alarms SNS topic. Leave empty to create the topic without a subscription."
}