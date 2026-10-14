output "state_bucket_name" {
  value = aws_s3_bucket.state.id
}

output "lock_table_name" {
  value = aws_dynamodb_table.locks.name
}

# Copy these into the repo's `dev` GitHub environment (Settings -> Environments).
output "AWS_DEPLOY_ROLE_ARN" {
  description = "GitHub environment variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_deploy.arn
}

output "TF_STATE_BUCKET" {
  description = "GitHub environment variable TF_STATE_BUCKET."
  value       = aws_s3_bucket.state.id
}

output "TF_STATE_LOCK_TABLE" {
  description = "GitHub environment variable TF_STATE_LOCK_TABLE."
  value       = aws_dynamodb_table.locks.name
}

output "AWS_REGION" {
  description = "GitHub environment variable AWS_REGION."
  value       = var.aws_region
}
