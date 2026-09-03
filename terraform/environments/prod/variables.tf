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

variable "alarm_notification_email" {
  type        = string
  default     = ""
  description = "Email address subscribed to the CloudWatch alarms SNS topic. Leave empty to create the topic without a subscription."
}