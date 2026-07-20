variable "bus_name" {
  type        = string
  description = "Custom EventBridge bus name."
}

variable "create_bus" {
  type        = bool
  default     = true
  description = "Whether the module should create the EventBridge bus or use an existing one."
}

variable "rules" {
  description = "EventBridge rules and targets."
  type = map(object({
    description   = string
    event_pattern = string
    target_arn    = string
    target_id     = string
    role_arn      = optional(string)
  }))
  default = {}
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Common tags."
}