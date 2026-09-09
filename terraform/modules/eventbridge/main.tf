resource "aws_cloudwatch_event_bus" "this" {
  count = var.create_bus ? 1 : 0
  name  = var.bus_name
  tags  = var.tags
}

data "aws_cloudwatch_event_bus" "existing" {
  count = var.create_bus ? 0 : 1
  name  = var.bus_name
}

locals {
  resolved_bus_name = var.create_bus ? aws_cloudwatch_event_bus.this[0].name : data.aws_cloudwatch_event_bus.existing[0].name
  resolved_bus_arn  = var.create_bus ? aws_cloudwatch_event_bus.this[0].arn : data.aws_cloudwatch_event_bus.existing[0].arn
}

resource "aws_cloudwatch_event_rule" "this" {
  for_each       = var.rules
  name           = "${var.bus_name}-${each.key}"
  description    = each.value.description
  event_bus_name = local.resolved_bus_name
  event_pattern  = each.value.event_pattern
}

resource "aws_cloudwatch_event_target" "this" {
  for_each       = var.rules
  rule           = aws_cloudwatch_event_rule.this[each.key].name
  event_bus_name = local.resolved_bus_name
  arn            = each.value.target_arn
  target_id      = each.value.target_id
  role_arn       = try(each.value.role_arn, null)

  dynamic "input_transformer" {
    for_each = each.value.input_transformer != null ? [each.value.input_transformer] : []

    content {
      input_paths    = input_transformer.value.input_paths
      input_template = input_transformer.value.input_template
    }
  }
}