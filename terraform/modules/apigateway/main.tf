data "aws_region" "current" {}

# Execution/access logs need the account-level CloudWatch role set via
# aws_api_gateway_account -- that's an AWS account/region-wide singleton
# (not per-API), so it's managed once in terraform/bootstrap rather than
# here, where dev and prod (separate states, same account) would otherwise
# fight over it on every apply. See terraform/bootstrap/apigateway-account.tf.
resource "aws_cloudwatch_log_group" "access_logs" {
  name              = "/aws/apigateway/${var.name}-access-logs"
  retention_in_days = 14
  tags              = var.tags
}

resource "aws_api_gateway_rest_api" "this" {
  name = var.name

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = var.tags

  # A change that forces replacement (e.g. endpoint_configuration.types)
  # would otherwise delete this API before the replacement exists, taking
  # the deployed stage down for the duration of the apply.
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_request_validator" "body" {
  rest_api_id                 = aws_api_gateway_rest_api.this.id
  name                        = "${var.name}-body-validator"
  validate_request_body       = true
  validate_request_parameters = false
}

resource "aws_api_gateway_model" "create_order" {
  rest_api_id  = aws_api_gateway_rest_api.this.id
  name         = "CreateOrderModel"
  content_type = "application/json"
  schema = jsonencode({
    type     = "object"
    required = ["customerId", "items"]
    properties = {
      customerId = {
        type = "string"
      }
      items = {
        type     = "array"
        minItems = 1
        items = {
          type     = "object"
          required = ["productId", "quantity"]
          properties = {
            productId = {
              type = "string"
            }
            quantity = {
              type    = "integer"
              minimum = 1
            }
          }
        }
      }
    }
  })
}

resource "aws_api_gateway_resource" "orders" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "orders"
}

resource "aws_api_gateway_resource" "order_id" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.orders.id
  path_part   = "{id}"
}

resource "aws_api_gateway_method" "post_orders" {
  rest_api_id          = aws_api_gateway_rest_api.this.id
  resource_id          = aws_api_gateway_resource.orders.id
  http_method          = "POST"
  authorization        = "NONE"
  request_validator_id = aws_api_gateway_request_validator.body.id

  request_models = {
    "application/json" = aws_api_gateway_model.create_order.name
  }
}

resource "aws_api_gateway_method" "get_orders" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.orders.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "get_order" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.order_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "delete_order" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.order_id.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_orders" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.orders.id
  http_method             = aws_api_gateway_method.post_orders.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.create_order_invoke_arn
}

resource "aws_api_gateway_integration" "get_orders" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.orders.id
  http_method             = aws_api_gateway_method.get_orders.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.list_orders_invoke_arn
}

resource "aws_api_gateway_integration" "get_order" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.order_id.id
  http_method             = aws_api_gateway_method.get_order.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.get_order_invoke_arn
}

resource "aws_api_gateway_integration" "delete_order" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.order_id.id
  http_method             = aws_api_gateway_method.delete_order.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.cancel_order_invoke_arn
}

locals {
  # OPTIONS preflight support for browser clients: POST /orders carries a
  # custom Content-Type/x-correlation-id/idempotency-key headers, which
  # forces a CORS preflight that a bare AWS_PROXY integration doesn't answer
  # on its own. The actual GET/POST/DELETE responses already carry
  # Access-Control-Allow-Origin from the Lambda itself (see
  # src/shared/utils/http.ts); this only adds the preflight response.
  cors_resources = {
    orders   = { resource_id = aws_api_gateway_resource.orders.id, methods = "GET,POST,OPTIONS" }
    order_id = { resource_id = aws_api_gateway_resource.order_id.id, methods = "GET,DELETE,OPTIONS" }
  }
}

resource "aws_api_gateway_method" "cors_options" {
  for_each      = local.cors_resources
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = each.value.resource_id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "cors_options" {
  for_each    = local.cors_resources
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = each.value.resource_id
  http_method = aws_api_gateway_method.cors_options[each.key].http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "cors_options" {
  for_each    = local.cors_resources
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = each.value.resource_id
  http_method = aws_api_gateway_method.cors_options[each.key].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "cors_options" {
  for_each    = local.cors_resources
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = each.value.resource_id
  http_method = aws_api_gateway_method.cors_options[each.key].http_method
  status_code = aws_api_gateway_method_response.cors_options[each.key].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,x-correlation-id,idempotency-key'"
    "method.response.header.Access-Control-Allow-Methods" = "'${each.value.methods}'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_integration.cors_options]
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  # aws_api_gateway_deployment has no argument that reflects the methods,
  # integrations or models it deploys, so depends_on alone only orders
  # creation on a from-scratch apply -- it does NOT force a new deployment
  # on an environment that was already applied before this resource's
  # dependencies changed (a well-known AWS provider gotcha). Hashing this
  # module's own source keeps every change to those resources content-
  # sensitive without hand-listing which nested attribute actually matters.
  triggers = {
    redeployment = filesha1("${path.module}/main.tf")
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.post_orders,
    aws_api_gateway_integration.get_orders,
    aws_api_gateway_integration.get_order,
    aws_api_gateway_integration.delete_order,
    aws_api_gateway_integration_response.cors_options
  ]
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id          = aws_api_gateway_rest_api.this.id
  deployment_id        = aws_api_gateway_deployment.this.id
  stage_name           = var.stage_name
  xray_tracing_enabled = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access_logs.arn
    # $context fields only -- the app's own x-correlation-id (see
    # src/shared/utils/http.ts) isn't one of API Gateway's supported access
    # log variables, so it shows up in the Lambda's own structured logs
    # instead, joined to this by $context.requestId.
    format = jsonencode({
      requestId               = "$context.requestId"
      sourceIp                = "$context.identity.sourceIp"
      requestTime             = "$context.requestTime"
      httpMethod              = "$context.httpMethod"
      resourcePath            = "$context.resourcePath"
      status                  = "$context.status"
      protocol                = "$context.protocol"
      responseLength          = "$context.responseLength"
      integrationErrorMessage = "$context.integrationErrorMessage"
    })
  }

  tags = var.tags
}

# Applies to every method on the stage ("*/*"): per-route overrides aren't
# needed here since all four routes (create/get/list/cancel order) should
# share the same budget.
resource "aws_api_gateway_method_settings" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  method_path = "*/*"

  settings {
    throttling_rate_limit  = var.throttling_rate_limit
    throttling_burst_limit = var.throttling_burst_limit
    metrics_enabled        = true
    logging_level          = "INFO"
  }
}