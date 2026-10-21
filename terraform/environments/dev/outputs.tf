output "orders_table_name" {
  value = module.dynamodb.table_name
}

output "event_bus_name" {
  value = module.eventbridge.bus_name
}

output "api_invoke_url" {
  value = module.api_gateway.invoke_url
}

output "state_machine_arn" {
  value = module.order_processing_state_machine.arn
}