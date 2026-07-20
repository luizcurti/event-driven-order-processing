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
  default     = "dev"
  description = "Environment name."
}

variable "waf_rate_limit" {
  type        = number
  default     = 2000
  description = "WAF requests per 5-minute period."
}