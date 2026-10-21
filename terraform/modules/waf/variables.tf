variable "name" {
  type        = string
  description = "WAF ACL name."
}

variable "rate_limit" {
  type        = number
  description = "Allowed requests per 5-minute period."
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Common tags."
}