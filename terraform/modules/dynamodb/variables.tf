variable "table_name" {
  description = "Orders table name."
  type        = string
}

variable "tags" {
  description = "Tags applied to the DynamoDB table."
  type        = map(string)
  default     = {}
}