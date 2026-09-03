data "aws_region" "current" {}

resource "aws_api_gateway_rest_api" "this" {
  name = var.name

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = var.tags
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
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.stage_name
  tags          = var.tags
}