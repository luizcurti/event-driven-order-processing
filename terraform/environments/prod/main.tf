locals {
  name_prefix = "${var.project_name}-${var.environment}"

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # role_group selects the least-privilege IAM role each function gets from
  # the iam_* modules below: "read-only" (query/get only), "order-write"
  # (read/write the orders table + publish events), "shipping" (order-write
  # plus consuming shipping-queue) or "notification" (consumes
  # notification-queue only -- it never touches DynamoDB or EventBridge).
  lambda_config = {
    create-order = {
      handler    = "index.handler"
      timeout    = 15
      role_group = "order-write"
    }
    get-order = {
      handler    = "index.handler"
      timeout    = 10
      role_group = "read-only"
    }
    list-orders = {
      handler    = "index.handler"
      timeout    = 10
      role_group = "read-only"
    }
    cancel-order = {
      handler    = "index.handler"
      timeout    = 10
      role_group = "order-write"
    }
    inventory = {
      handler    = "index.handler"
      timeout    = 15
      role_group = "order-write"
    }
    payment = {
      handler    = "index.handler"
      timeout    = 15
      role_group = "order-write"
    }
    fraud = {
      handler    = "index.handler"
      timeout    = 15
      role_group = "order-write"
    }
    shipping = {
      handler    = "index.handler"
      timeout    = 30
      role_group = "shipping"
    }
    notification = {
      handler    = "index.handler"
      timeout    = 30
      role_group = "notification"
    }
    update-order = {
      handler    = "index.handler"
      timeout    = 15
      role_group = "order-write"
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

  # Rules reference the state machine and the EventBridge-to-StepFunctions
  # role declared further down in this file. Terraform resolves this by
  # dependency graph, not file order, and the bus itself (created inside
  # this same module) has no dependency on those resources, so there is no
  # cycle. Keeping bus creation and rule attachment in a single module call
  # avoids a chicken-and-egg problem: a second module instance targeting
  # this bus with create_bus=false would need a data source lookup that
  # fails on a from-scratch apply because the bus doesn't exist yet.
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
      input_transformer = {
        input_paths = {
          orderId       = "$.detail.detail.orderId"
          correlationId = "$.detail.correlationId"
          reason        = "$.detail.detail.reason"
        }
        input_template = "{\"orderId\": <orderId>, \"correlationId\": <correlationId>, \"reason\": <reason>}"
      }
    }
    payment-failed = {
      description   = "Route payment failures to the notification queue."
      event_pattern = jsonencode({ source = ["order.processing"], "detail-type" = ["PaymentFailed"] })
      target_arn    = module.sqs.notification_queue_arn
      target_id     = "payment-failed-notification"
      input_transformer = {
        input_paths = {
          orderId       = "$.detail.detail.orderId"
          correlationId = "$.detail.correlationId"
          reason        = "$.detail.detail.reason"
        }
        input_template = "{\"orderId\": <orderId>, \"correlationId\": <correlationId>, \"reason\": <reason>}"
      }
    }
    fraud-rejected = {
      description   = "Route fraud rejections to the notification queue."
      event_pattern = jsonencode({ source = ["order.processing"], "detail-type" = ["FraudRejected"] })
      target_arn    = module.sqs.notification_queue_arn
      target_id     = "fraud-rejected-notification"
      input_transformer = {
        input_paths = {
          orderId       = "$.detail.detail.orderId"
          correlationId = "$.detail.correlationId"
          reason        = "$.detail.detail.reason"
        }
        input_template = "{\"orderId\": <orderId>, \"correlationId\": <correlationId>, \"reason\": <reason>}"
      }
    }
    order-approved = {
      description   = "Route approved orders to the shipping queue."
      event_pattern = jsonencode({ source = ["order.processing"], "detail-type" = ["OrderApproved"] })
      target_arn    = module.sqs.shipping_queue_arn
      target_id     = "shipping-order"
      input_transformer = {
        input_paths = {
          orderId       = "$.detail.detail.orderId"
          correlationId = "$.detail.correlationId"
        }
        input_template = "{\"orderId\": <orderId>, \"correlationId\": <correlationId>}"
      }
    }
  }
}

module "dynamodb" {
  source     = "../../modules/dynamodb"
  table_name = "${local.name_prefix}-orders"
  tags       = local.tags
}

# Least-privilege Lambda execution roles, one per access pattern (see the
# role_group comment on local.lambda_config above). Deliberately grouped
# rather than one role per function: still a large reduction in blast radius
# from a single shared role, without 10 near-identical role definitions.
module "iam_read_only" {
  source             = "../../modules/iam-lambda-role"
  role_name          = "${local.name_prefix}-read-only-role"
  dynamodb_table_arn = module.dynamodb.table_arn
  dynamodb_actions   = ["dynamodb:GetItem", "dynamodb:Query"]
  tags               = local.tags
}

module "iam_order_write" {
  source             = "../../modules/iam-lambda-role"
  role_name          = "${local.name_prefix}-order-write-role"
  dynamodb_table_arn = module.dynamodb.table_arn
  # Union of what every function sharing this role needs: create-order's
  # idempotent create (Query on IdempotencyIndex, then a TransactWriteItems
  # put of the order + marker) needs Query/PutItem/TransactWriteItems --
  # PutItem is required alongside TransactWriteItems because DynamoDB's IAM
  # check for a Put-type transaction item also requires the underlying
  # single-item action, even though no code ever issues a raw PutItem call.
  # cancel-order/update-order/inventory/payment/fraud only ever call
  # repository.updateStatus() (GetItem + UpdateItem, see iam_shipping above
  # for the same pattern without the create-order-only actions).
  dynamodb_actions = [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:Query",
    "dynamodb:TransactWriteItems"
  ]
  event_bus_arn    = module.eventbridge.bus_arn
  allow_events_put = true
  tags             = local.tags
}

module "iam_shipping" {
  source             = "../../modules/iam-lambda-role"
  role_name          = "${local.name_prefix}-shipping-role"
  dynamodb_table_arn = module.dynamodb.table_arn
  # ProcessShippingUseCase only ever calls repository.updateStatus() (never
  # create()), so it needs UpdateItem plus the GetItem the repository's
  # conditional-check-failure fallback issues -- not Query/PutItem/
  # TransactWriteItems, which only create-order's idempotent-create path uses.
  dynamodb_actions = [
    "dynamodb:GetItem",
    "dynamodb:UpdateItem"
  ]
  event_bus_arn          = module.eventbridge.bus_arn
  allow_events_put       = true
  sqs_consume_queue_arns = [module.sqs.shipping_queue_arn]
  tags                   = local.tags
}

module "iam_notification" {
  source                 = "../../modules/iam-lambda-role"
  role_name              = "${local.name_prefix}-notification-role"
  sqs_consume_queue_arns = [module.sqs.notification_queue_arn]
  tags                   = local.tags
}

locals {
  lambda_role_arns = {
    read-only    = module.iam_read_only.role_arn
    order-write  = module.iam_order_write.role_arn
    shipping     = module.iam_shipping.role_arn
    notification = module.iam_notification.role_arn
  }
}

module "lambdas" {
  for_each = local.lambda_config
  source   = "../../modules/lambda"

  function_name = "${local.name_prefix}-${each.key}"
  filename      = "${path.root}/../../../artifacts/${each.key}.zip"
  handler       = each.value.handler
  timeout       = each.value.timeout
  role_arn      = local.lambda_role_arns[each.value.role_group]
  tags          = local.tags

  environment_variables = {
    ORDERS_TABLE_NAME       = module.dynamodb.table_name
    EVENT_BUS_NAME          = module.eventbridge.bus_name
    FEATURE_INVENTORY_CHECK = "true"
    FEATURE_FRAUD_CHECK     = "true"
  }
}

module "iam_step_functions_role" {
  source                 = "../../modules/iam-step-functions-role"
  role_name              = "${local.name_prefix}-step-functions-role"
  event_bus_arn          = module.eventbridge.bus_arn
  shipping_queue_arn     = module.sqs.shipping_queue_arn
  notification_queue_arn = module.sqs.notification_queue_arn
  lambda_arns            = [for lambda in module.lambdas : lambda.function_arn]
  tags                   = local.tags
}

module "order_processing_state_machine" {
  source   = "../../modules/stepfunctions"
  name     = "${local.name_prefix}-order-processing"
  role_arn = module.iam_step_functions_role.role_arn
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
      values   = [module.eventbridge.rule_arns["order-approved"]]
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
        module.eventbridge.rule_arns["inventory-failed"],
        module.eventbridge.rule_arns["payment-failed"],
        module.eventbridge.rule_arns["fraud-rejected"]
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

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
  tags = local.tags
}

# Optional: only created when alarm_notification_email is set, so this stack
# still applies cleanly out of the box without requiring a real inbox.
resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alarm_notification_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_notification_email
}

module "alarms" {
  source                = "../../modules/alarms"
  lambda_function_names = [for lambda in module.lambdas : lambda.function_name]
  queue_names           = [module.sqs.shipping_queue_name, module.sqs.notification_queue_name, module.sqs.dead_letter_queue_name]
  state_machine_name    = module.order_processing_state_machine.arn
  alarm_actions         = [aws_sns_topic.alerts.arn]
}