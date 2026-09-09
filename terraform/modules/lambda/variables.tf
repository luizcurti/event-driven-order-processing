variable "function_name" {
  type        = string
  description = "Lambda function name."
}

variable "filename" {
  type        = string
  description = "Path to the deployment zip artifact."
}

variable "handler" {
  type        = string
  description = "Lambda handler entrypoint."
}

variable "role_arn" {
  type        = string
  description = "IAM role ARN used by the Lambda function."
}

variable "environment_variables" {
  type        = map(string)
  default     = {}
  description = "Environment variables injected into the Lambda function."
}

variable "runtime" {
  type        = string
  default     = "nodejs22.x"
  description = "Lambda runtime."
}

variable "timeout" {
  type        = number
  default     = 30
  description = "Lambda timeout in seconds."
}

variable "memory_size" {
  type        = number
  default     = 256
  description = "Lambda memory size in MB."
}

variable "reserved_concurrent_executions" {
  type        = number
  default     = -1
  description = "Reserved concurrency for this function. -1 (default) leaves it unreserved, drawing from the account's shared pool -- set a positive number to cap how much of that pool a single buggy/looping function can consume."
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Common tags."
}