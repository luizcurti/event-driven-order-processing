variable "lambda_function_names" {
  type        = list(string)
  default     = []
  description = "Lambda functions monitored for errors and throttles."
}

variable "lambda_timeouts" {
  type        = map(number)
  default     = {}
  description = "Map of Lambda function name to its configured timeout in seconds, used to alarm when Duration approaches that timeout. Functions absent from this map get no duration alarm."
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

variable "api_gateway_name" {
  type        = string
  default     = ""
  description = "API Gateway REST API name monitored for 4XX/5XX errors. Leave empty to skip these alarms."
}

variable "api_gateway_stage_name" {
  type        = string
  default     = ""
  description = "API Gateway stage name monitored for 4XX/5XX errors."
}

variable "alarm_actions" {
  type        = list(string)
  default     = []
  description = "SNS topics or actions triggered by alarms."
}