resource "aws_sqs_queue" "dead_letter" {
  name                      = var.dead_letter_queue_name
  message_retention_seconds = 1209600
  tags                      = var.tags
}

resource "aws_sqs_queue" "shipping" {
  name                       = var.shipping_queue_name
  visibility_timeout_seconds = 60
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = 3
  })
  tags = var.tags
}

resource "aws_sqs_queue" "notification" {
  name                       = var.notification_queue_name
  visibility_timeout_seconds = 60
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = 3
  })
  tags = var.tags
}