variable "name" {
  type        = string
  description = "API Gateway name."
}

variable "stage_name" {
  type        = string
  description = "Stage name."
}

variable "create_order_invoke_arn" {
  type        = string
  description = "Invoke ARN for create-order Lambda."
}

variable "get_order_invoke_arn" {
  type        = string
  description = "Invoke ARN for get-order Lambda."
}

variable "list_orders_invoke_arn" {
  type        = string
  description = "Invoke ARN for list-orders Lambda."
}

variable "cancel_order_invoke_arn" {
  type        = string
  description = "Invoke ARN for cancel-order Lambda."
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Common tags."
}