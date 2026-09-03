data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

# Scoped per-caller policy: only the statements a given Lambda's role
# actually needs are included, keeping every function's permissions to what
# its own use case touches (see terraform/environments/*/main.tf for how
# each function is assigned to a role).
data "aws_iam_policy_document" "this" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  dynamic "statement" {
    for_each = length(var.dynamodb_actions) > 0 ? [1] : []
    content {
      sid     = "DynamoDb"
      actions = var.dynamodb_actions
      resources = [
        var.dynamodb_table_arn,
        "${var.dynamodb_table_arn}/index/*"
      ]
    }
  }

  dynamic "statement" {
    for_each = var.allow_events_put ? [1] : []
    content {
      sid       = "PutEvents"
      actions   = ["events:PutEvents"]
      resources = [var.event_bus_arn]
    }
  }

  dynamic "statement" {
    for_each = length(var.sqs_consume_queue_arns) > 0 ? [1] : []
    content {
      sid       = "ConsumeQueue"
      actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
      resources = var.sqs_consume_queue_arns
    }
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
