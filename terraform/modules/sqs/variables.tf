variable "shipping_queue_name" {
  type        = string
  description = "Shipping queue name."
}

variable "notification_queue_name" {
  type        = string
  description = "Notification queue name."
}

variable "dead_letter_queue_name" {
  type        = string
  description = "Dead letter queue name."
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Common tags."
}