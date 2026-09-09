resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = toset(var.lambda_function_names)
  alarm_name          = "${each.value}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = var.alarm_actions

  dimensions = {
    FunctionName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_depth" {
  for_each            = toset(var.queue_names)
  alarm_name          = "${each.value}-depth"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 2
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = var.alarm_actions

  dimensions = {
    QueueName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each            = toset(var.lambda_function_names)
  alarm_name          = "${each.value}-throttles"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = var.alarm_actions

  dimensions = {
    FunctionName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_duration" {
  for_each           = var.lambda_timeouts
  alarm_name         = "${each.key}-duration-near-timeout"
  namespace          = "AWS/Lambda"
  metric_name        = "Duration"
  statistic          = "Maximum"
  period             = 60
  evaluation_periods = 1
  # Fires once the slowest invocation in a period crosses 80% of the
  # function's configured timeout (Duration is in milliseconds, timeout in
  # seconds) -- close enough to actually timing out to be worth paging on
  # before invocations start failing outright.
  threshold           = each.value * 1000 * 0.8
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = var.alarm_actions

  dimensions = {
    FunctionName = each.key
  }
}

resource "aws_cloudwatch_metric_alarm" "state_machine_failures" {
  alarm_name          = "${var.state_machine_name}-failures"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsFailed"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = var.alarm_actions

  dimensions = {
    StateMachineArn = var.state_machine_name
  }
}

resource "aws_cloudwatch_metric_alarm" "state_machine_timed_out" {
  alarm_name          = "${var.state_machine_name}-timed-out"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsTimedOut"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = var.alarm_actions

  dimensions = {
    StateMachineArn = var.state_machine_name
  }
}

resource "aws_cloudwatch_metric_alarm" "api_gateway_4xx" {
  count               = var.api_gateway_name != "" ? 1 : 0
  alarm_name          = "${var.api_gateway_name}-4xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "4XXError"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = var.alarm_actions

  dimensions = {
    ApiName = var.api_gateway_name
    Stage   = var.api_gateway_stage_name
  }
}

resource "aws_cloudwatch_metric_alarm" "api_gateway_5xx" {
  count               = var.api_gateway_name != "" ? 1 : 0
  alarm_name          = "${var.api_gateway_name}-5xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = var.alarm_actions

  dimensions = {
    ApiName = var.api_gateway_name
    Stage   = var.api_gateway_stage_name
  }
}