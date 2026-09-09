variable "dashboard_name" {
  type        = string
  description = "Dashboard name."
}

variable "lambda_function_names" {
  type        = list(string)
  default     = []
  description = "Lambda names displayed on the dashboard."
}

variable "queue_names" {
  type        = list(string)
  default     = []
  description = "SQS queue names displayed on the dashboard."
}

variable "state_machine_name" {
  type        = string
  description = "State machine name displayed on the dashboard."
}