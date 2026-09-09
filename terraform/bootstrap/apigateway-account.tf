# API Gateway's CloudWatch role is an account/region-wide singleton
# (aws_api_gateway_account has no name/key to scope it by), so it's set here
# once rather than inside terraform/modules/apigateway -- that module is
# instantiated separately by dev and prod, which would otherwise fight over
# this same setting on every apply. Without it, both execution logs and the
# access_log_settings configured on each environment's stage silently
# produce nothing.
data "aws_iam_policy_document" "apigateway_cloudwatch_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["apigateway.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "apigateway_cloudwatch" {
  name               = "apigateway-cloudwatch-logs-role"
  assume_role_policy = data.aws_iam_policy_document.apigateway_cloudwatch_assume_role.json
}

resource "aws_iam_role_policy_attachment" "apigateway_cloudwatch" {
  role       = aws_iam_role.apigateway_cloudwatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

resource "aws_api_gateway_account" "this" {
  cloudwatch_role_arn = aws_iam_role.apigateway_cloudwatch.arn
}
