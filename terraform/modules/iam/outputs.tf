output "lambda_role_arn" {
  value = aws_iam_role.lambda.arn
}

output "step_functions_role_arn" {
  value = aws_iam_role.step_functions.arn
}