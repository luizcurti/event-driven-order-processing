output "lambda_alarm_names" {
  value = [for alarm in aws_cloudwatch_metric_alarm.lambda_errors : alarm.alarm_name]
}

output "lambda_throttle_alarm_names" {
  value = [for alarm in aws_cloudwatch_metric_alarm.lambda_throttles : alarm.alarm_name]
}

output "lambda_duration_alarm_names" {
  value = [for alarm in aws_cloudwatch_metric_alarm.lambda_duration : alarm.alarm_name]
}

output "queue_alarm_names" {
  value = [for alarm in aws_cloudwatch_metric_alarm.queue_depth : alarm.alarm_name]
}

output "state_machine_alarm_name" {
  value = aws_cloudwatch_metric_alarm.state_machine_failures.alarm_name
}

output "state_machine_timed_out_alarm_name" {
  value = aws_cloudwatch_metric_alarm.state_machine_timed_out.alarm_name
}

output "api_gateway_alarm_names" {
  value = concat(
    [for alarm in aws_cloudwatch_metric_alarm.api_gateway_4xx : alarm.alarm_name],
    [for alarm in aws_cloudwatch_metric_alarm.api_gateway_5xx : alarm.alarm_name]
  )
}