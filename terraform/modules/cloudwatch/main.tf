data "aws_region" "current" {}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.dashboard_name

  dashboard_body = jsonencode({
    widgets = concat(
      [
        {
          type   = "metric"
          width  = 24
          height = 6
          properties = {
            title   = "Step Functions executions"
            region  = data.aws_region.current.name
            stat    = "Sum"
            view    = "timeSeries"
            metrics = [["AWS/States", "ExecutionsFailed", "StateMachineArn", var.state_machine_name]]
          }
        }
      ],
      [for function_name in var.lambda_function_names : {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title   = "${function_name} errors"
          region  = data.aws_region.current.name
          stat    = "Sum"
          view    = "timeSeries"
          metrics = [["AWS/Lambda", "Errors", "FunctionName", function_name]]
        }
      }],
      [for queue_name in var.queue_names : {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title   = "${queue_name} visible messages"
          region  = data.aws_region.current.name
          stat    = "Average"
          view    = "timeSeries"
          metrics = [["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", queue_name]]
        }
      }]
    )
  })
}