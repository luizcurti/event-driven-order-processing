{
  "Comment": "Order processing workflow",
  "StartAt": "CheckInventory",
  "States": {
    "CheckInventory": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "OutputPath": "$.Payload",
      "Parameters": {
        "FunctionName": "${inventory_lambda_arn}",
        "Payload": {
          "orderId.$": "$.detail.detail.orderId",
          "correlationId.$": "$.detail.correlationId"
        }
      },
      "Retry": [
        {
          "ErrorEquals": ["Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Next": "InventoryDecision"
    },
    "InventoryDecision": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.inventoryStatus",
          "StringEquals": "AVAILABLE",
          "Next": "ProcessPayment"
        }
      ],
      "Default": "EndOutOfStock"
    },
    "ProcessPayment": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "OutputPath": "$.Payload",
      "Parameters": {
        "FunctionName": "${payment_lambda_arn}",
        "Payload": {
          "orderId.$": "$.orderId",
          "correlationId.$": "$.correlationId"
        }
      },
      "Retry": [
        {
          "ErrorEquals": ["Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Next": "PaymentDecision"
    },
    "PaymentDecision": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.paymentStatus",
          "StringEquals": "APPROVED",
          "Next": "CheckFraud"
        }
      ],
      "Default": "EndPaymentFailed"
    },
    "CheckFraud": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "OutputPath": "$.Payload",
      "Parameters": {
        "FunctionName": "${fraud_lambda_arn}",
        "Payload": {
          "orderId.$": "$.orderId",
          "correlationId.$": "$.correlationId"
        }
      },
      "Retry": [
        {
          "ErrorEquals": ["Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Next": "FraudDecision"
    },
    "FraudDecision": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.fraudStatus",
          "StringEquals": "APPROVED",
          "Next": "PublishOrderApproved"
        }
      ],
      "Default": "EndFraudRejected"
    },
    "PublishOrderApproved": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents",
      "Parameters": {
        "Entries": [
          {
            "EventBusName": "${event_bus_name}",
            "Source": "order.processing",
            "DetailType": "OrderApproved",
            "Detail": {
              "version": "v1",
              "correlationId.$": "$.correlationId",
              "timestamp.$": "$$.State.EnteredTime",
              "detail": {
                "orderId.$": "$.orderId",
                "status": "APPROVED"
              }
            }
          }
        ]
      },
      "End": true
    },
    "EndOutOfStock": {
      "Type": "Succeed"
    },
    "EndPaymentFailed": {
      "Type": "Succeed"
    },
    "EndFraudRejected": {
      "Type": "Succeed"
    }
  }
}