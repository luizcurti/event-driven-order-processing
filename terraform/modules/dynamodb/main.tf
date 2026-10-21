resource "aws_dynamodb_table" "orders" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "idempotencyKey"
    type = "S"
  }

  global_secondary_index {
    name            = "IdempotencyIndex"
    hash_key        = "idempotencyKey"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "OrderTypeIndex"
    hash_key        = "sk"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  # DynamoDB-native deletion protection instead of `lifecycle { prevent_destroy }`:
  # prevent_destroy can't be driven by a variable, so it would block the dev
  # environment's Destroy workflow too. prod keeps it on (see its variables.tf).
  deletion_protection_enabled = var.deletion_protection_enabled

  tags = var.tags
}