output "lambda_alarm_names" {
  value = [for alarm in aws_cloudwatch_metric_alarm.lambda_errors : alarm.alarm_name]
}

output "queue_alarm_names" {
  value = [for alarm in aws_cloudwatch_metric_alarm.queue_depth : alarm.alarm_name]
}

output "state_machine_alarm_name" {
  value = aws_cloudwatch_metric_alarm.state_machine_failures.alarm_name
}