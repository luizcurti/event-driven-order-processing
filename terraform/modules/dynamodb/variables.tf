variable "table_name" {
  description = "Orders table name."
  type        = string
}

variable "tags" {
  description = "Tags applied to the DynamoDB table."
  type        = map(string)
  default     = {}
}

variable "deletion_protection_enabled" {
  description = "Block DeleteTable (including terraform destroy) until this is turned off."
  type        = bool
  default     = true
}
