output "bus_name" {
  value = local.resolved_bus_name
}

output "bus_arn" {
  value = local.resolved_bus_arn
}

output "rule_arns" {
  value = { for key, rule in aws_cloudwatch_event_rule.this : key => rule.arn }
}