variable "role_name" {
  type        = string
  description = "IAM role name for this Lambda execution role."
}

variable "dynamodb_table_arn" {
  type        = string
  default     = null
  description = "Orders table ARN. Required when dynamodb_actions is non-empty."
}

variable "dynamodb_actions" {
  type        = list(string)
  default     = []
  description = "DynamoDB actions to allow on the table and its indexes. Leave empty to grant no DynamoDB access."
}

variable "event_bus_arn" {
  type        = string
  default     = null
  description = "EventBridge bus ARN. Required when allow_events_put is true."
}

variable "allow_events_put" {
  type        = bool
  default     = false
  description = "Grants events:PutEvents on event_bus_arn."
}

variable "sqs_consume_queue_arns" {
  type        = list(string)
  default     = []
  description = "SQS queues this role may receive/delete messages from (event source mapping consumers). Leave empty to grant no SQS access."
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Tags applied to IAM resources."
}
