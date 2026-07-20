variable "lambda_function_names" {
  type        = list(string)
  default     = []
  description = "Lambda functions monitored for errors."
}

variable "queue_names" {
  type        = list(string)
  default     = []
  description = "SQS queues monitored for depth."
}

variable "state_machine_name" {
  type        = string
  description = "State machine name monitored for failures."
}

variable "alarm_actions" {
  type        = list(string)
  default     = []
  description = "SNS topics or actions triggered by alarms."
}