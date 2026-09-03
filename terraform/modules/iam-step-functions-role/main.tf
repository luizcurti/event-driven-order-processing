data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

data "aws_iam_policy_document" "this" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = var.lambda_arns
  }

  statement {
    actions   = ["events:PutEvents"]
    resources = [var.event_bus_arn]
  }

  statement {
    actions   = ["sqs:SendMessage"]
    resources = [var.shipping_queue_arn, var.notification_queue_arn]
  }

  statement {
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "this" {
  name   = "${var.role_name}-policy"
  policy = data.aws_iam_policy_document.this.json
  tags   = var.tags
}

resource "aws_iam_role_policy_attachment" "this" {
  role       = aws_iam_role.this.name
  policy_arn = aws_iam_policy.this.arn
}
