output "shipping_queue_arn" {
  value = aws_sqs_queue.shipping.arn
}

output "shipping_queue_url" {
  value = aws_sqs_queue.shipping.url
}

output "shipping_queue_name" {
  value = aws_sqs_queue.shipping.name
}

output "notification_queue_arn" {
  value = aws_sqs_queue.notification.arn
}

output "notification_queue_url" {
  value = aws_sqs_queue.notification.url
}

output "notification_queue_name" {
  value = aws_sqs_queue.notification.name
}

output "dead_letter_queue_arn" {
  value = aws_sqs_queue.dead_letter.arn
}

output "dead_letter_queue_name" {
  value = aws_sqs_queue.dead_letter.name
}