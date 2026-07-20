locals {
  name_prefix = "${var.project_name}-${var.environment}"

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  lambda_config = {
    create-order = {
      handler = "dist/src/create-order/handler/index.handler"
      timeout = 15
    }
    get-order = {
      handler = "dist/src/orders/handler/get-order.handler"
      timeout = 10
    }
    list-orders = {
      handler = "dist/src/orders/handler/list-orders.handler"
      timeout = 10
    }
    cancel-order = {
      handler = "dist/src/orders/handler/cancel-order.handler"
      timeout = 10
    }
    inventory = {
      handler = "dist/src/inventory/handler/index.handler"
      timeout = 15
    }
    payment = {
      handler = "dist/src/payment/handler/index.handler"
      timeout = 15
    }
    fraud = {
      handler = "dist/src/fraud/handler/index.handler"
      timeout = 15
    }
    shipping = {
      handler = "dist/src/shipping/handler/index.handler"
      timeout = 30
    }
    notification = {
      handler = "dist/src/notification/handler/index.handler"
      timeout = 30
    }
    update-order = {
      handler = "dist/src/update-order/handler/index.handler"
      timeout = 15
    }
  }
}

module "sqs" {
  source                  = "../../modules/sqs"
  shipping_queue_name     = "${local.name_prefix}-shipping-queue"
  notification_queue_name = "${local.name_prefix}-notification-queue"
  dead_letter_queue_name  = "${local.name_prefix}-dead-letter-queue"
  tags                    = local.tags
}

module "eventbridge" {
  source   = "../../modules/eventbridge"
  bus_name = "${local.name_prefix}-bus"
  tags     = local.tags
  rules    = {}
}

module "dynamodb" {
  source     = "../../modules/dynamodb"
  table_name = "${local.name_prefix}-orders"
  tags       = local.tags
}

module "iam_bootstrap" {
  source                 = "../../modules/iam"
  project_name           = local.name_prefix
  orders_table_arn       = module.dynamodb.table_arn
  event_bus_arn          = module.eventbridge.bus_arn
  shipping_queue_arn     = module.sqs.shipping_queue_arn
  notification_queue_arn = module.sqs.notification_queue_arn
  lambda_arns            = []
  tags                   = local.tags
}

module "lambdas" {
  for_each = local.lambda_config
  source   = "../../modules/lambda"

  function_name = "${local.name_prefix}-${each.key}"
  filename      = "${path.root}/../../../artifacts/${each.key}.zip"
  handler       = each.value.handler
  timeout       = each.value.timeout
  role_arn      = module.iam_bootstrap.lambda_role_arn
  tags          = local.tags

  environment_variables = {
    ORDERS_TABLE_NAME       = module.dynamodb.table_name
    EVENT_BUS_NAME          = module.eventbridge.bus_name
    FEATURE_INVENTORY_CHECK = "true"
    FEATURE_FRAUD_CHECK     = "true"
  }
}

module "iam_runtime" {
  source                 = "../../modules/iam"
  project_name           = "${local.name_prefix}-runtime"
  orders_table_arn       = module.dynamodb.table_arn
  event_bus_arn          = module.eventbridge.bus_arn
  shipping_queue_arn     = module.sqs.shipping_queue_arn
  notification_queue_arn = module.sqs.notification_queue_arn
  lambda_arns            = [for lambda in module.lambdas : lambda.function_arn]
  tags                   = local.tags
}

module "order_processing_state_machine" {
  source   = "../../modules/stepfunctions"
  name     = "${local.name_prefix}-order-processing"
  role_arn = module.iam_runtime.step_functions_role_arn
  tags     = local.tags
  definition = templatefile("${path.module}/order-processing.asl.json.tpl", {
    inventory_lambda_arn = module.lambdas["inventory"].function_arn
    payment_lambda_arn   = module.lambdas["payment"].function_arn
    fraud_lambda_arn     = module.lambdas["fraud"].function_arn
    event_bus_name       = module.eventbridge.bus_name
  })
}

data "aws_iam_policy_document" "eventbridge_start_execution_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eventbridge_start_execution" {
  name               = "${local.name_prefix}-eventbridge-start-execution"
  assume_role_policy = data.aws_iam_policy_document.eventbridge_start_execution_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "eventbridge_start_execution" {
  statement {
    actions   = ["states:StartExecution"]
    resources = [module.order_processing_state_machine.arn]
  }
}

resource "aws_iam_policy" "eventbridge_start_execution" {
  name   = "${local.name_prefix}-eventbridge-start-execution"
  policy = data.aws_iam_policy_document.eventbridge_start_execution.json
  tags   = local.tags
}

resource "aws_iam_role_policy_attachment" "eventbridge_start_execution" {
  role       = aws_iam_role.eventbridge_start_execution.name
  policy_arn = aws_iam_policy.eventbridge_start_execution.arn
}

module "eventbridge_routes" {
  source     = "../../modules/eventbridge"
  bus_name   = module.eventbridge.bus_name
  create_bus = false
  tags       = local.tags
  rules = {
    order-created = {
      description   = "Start the Step Functions workflow when an order is created."
      event_pattern = jsonencode({ source = ["order.processing"], "detail-type" = ["OrderCreated"] })
      target_arn    = module.order_processing_state_machine.arn
      target_id     = "start-order-processing"
      role_arn      = aws_iam_role.eventbridge_start_execution.arn
    }
    inventory-failed = {
      description   = "Route inventory failures to the notification queue."
      event_pattern = jsonencode({ source = ["order.processing"], "detail-type" = ["InventoryFailed"] })
      target_arn    = module.sqs.notification_queue_arn
      target_id     = "inventory-failed-notification"
    }
    payment-failed = {
      description   = "Route payment failures to the notification queue."
      event_pattern = jsonencode({ source = ["order.processing"], "detail-type" = ["PaymentFailed"] })
      target_arn    = module.sqs.notification_queue_arn
      target_id     = "payment-failed-notification"
    }
    fraud-rejected = {
      description   = "Route fraud rejections to the notification queue."
      event_pattern = jsonencode({ source = ["order.processing"], "detail-type" = ["FraudRejected"] })
      target_arn    = module.sqs.notification_queue_arn
      target_id     = "fraud-rejected-notification"
    }
    order-approved = {
      description   = "Route approved orders to the shipping queue."
      event_pattern = jsonencode({ source = ["order.processing"], "detail-type" = ["OrderApproved"] })
      target_arn    = module.sqs.shipping_queue_arn
      target_id     = "shipping-order"
    }
  }
}

data "aws_iam_policy_document" "shipping_queue_policy" {
  statement {
    sid       = "AllowEventBridgeShipping"
    actions   = ["sqs:SendMessage"]
    resources = [module.sqs.shipping_queue_arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [module.eventbridge_routes.rule_arns["order-approved"]]
    }
  }
}

resource "aws_sqs_queue_policy" "shipping" {
  queue_url = module.sqs.shipping_queue_url
  policy    = data.aws_iam_policy_document.shipping_queue_policy.json
}

data "aws_iam_policy_document" "notification_queue_policy" {
  statement {
    sid       = "AllowEventBridgeNotifications"
    actions   = ["sqs:SendMessage"]
    resources = [module.sqs.notification_queue_arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values = [
        module.eventbridge_routes.rule_arns["inventory-failed"],
        module.eventbridge_routes.rule_arns["payment-failed"],
        module.eventbridge_routes.rule_arns["fraud-rejected"]
      ]
    }
  }
}

resource "aws_sqs_queue_policy" "notification" {
  queue_url = module.sqs.notification_queue_url
  policy    = data.aws_iam_policy_document.notification_queue_policy.json
}

resource "aws_lambda_event_source_mapping" "shipping" {
  event_source_arn = module.sqs.shipping_queue_arn
  function_name    = module.lambdas["shipping"].function_arn
  batch_size       = 10
}

resource "aws_lambda_event_source_mapping" "notification" {
  event_source_arn = module.sqs.notification_queue_arn
  function_name    = module.lambdas["notification"].function_arn
  batch_size       = 10
}

module "api_gateway" {
  source                  = "../../modules/apigateway"
  name                    = "${local.name_prefix}-api"
  stage_name              = var.environment
  create_order_invoke_arn = module.lambdas["create-order"].invoke_arn
  get_order_invoke_arn    = module.lambdas["get-order"].invoke_arn
  list_orders_invoke_arn  = module.lambdas["list-orders"].invoke_arn
  cancel_order_invoke_arn = module.lambdas["cancel-order"].invoke_arn
  tags                    = local.tags
}

resource "aws_lambda_permission" "api_gateway" {
  for_each      = { for key, lambda in module.lambdas : key => lambda if contains(["create-order", "get-order", "list-orders", "cancel-order"], key) }
  statement_id  = "AllowExecutionFromAPIGateway-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.execution_arn}/*/*"
}

module "waf" {
  source     = "../../modules/waf"
  name       = "${local.name_prefix}-waf"
  rate_limit = var.waf_rate_limit
  tags       = local.tags
}

resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = module.api_gateway.stage_arn
  web_acl_arn  = module.waf.arn
}

module "dashboard" {
  source                = "../../modules/cloudwatch"
  dashboard_name        = "${local.name_prefix}-dashboard"
  lambda_function_names = [for lambda in module.lambdas : lambda.function_name]
  queue_names           = [module.sqs.shipping_queue_name, module.sqs.notification_queue_name, module.sqs.dead_letter_queue_name]
  state_machine_name    = module.order_processing_state_machine.arn
}

module "alarms" {
  source                = "../../modules/alarms"
  lambda_function_names = [for lambda in module.lambdas : lambda.function_name]
  queue_names           = [module.sqs.shipping_queue_name, module.sqs.notification_queue_name, module.sqs.dead_letter_queue_name]
  state_machine_name    = module.order_processing_state_machine.arn
  alarm_actions         = []
}