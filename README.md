# event-driven-order-processing

Reference implementation of an AWS serverless order processing system using an event-driven architecture.

## Overview

The project exposes an orders API backed by API Gateway, WAF, Lambda, DynamoDB, EventBridge, Step Functions, SQS and CloudWatch. It is designed as a portfolio-ready codebase that demonstrates:

- Node.js 22 with TypeScript strict mode
- Event-driven orchestration with EventBridge and Step Functions
- Structured logging and correlation ID propagation
- Idempotent order creation
- Modular Terraform infrastructure
- Automated quality gates with GitHub Actions

## Architecture

Main flow:

1. Client sends `POST /orders`.
2. WAF protects the API Gateway endpoint.
3. `create-order` Lambda validates input, enforces idempotency, stores the order and publishes `OrderCreated`.
4. EventBridge starts the Step Functions workflow.
5. Step Functions orchestrates `inventory`, `payment` and `fraud` Lambdas with retries and exponential backoff.
6. Outcome events fan out to SQS queues.
7. `shipping` or `notification` Lambdas complete the asynchronous side effects.
8. CloudWatch dashboards and alarms provide observability.

## Project structure

```text
terraform/
  modules/
  environments/
src/
  shared/
  create-order/
  inventory/
  payment/
  fraud/
  shipping/
  notification/
  update-order/
  orders/
tests/
.github/workflows/
docs/
```

## API

### Create order

`POST /orders`

```json
{
  "customerId": "123",
  "items": [
    {
      "productId": "ABC",
      "quantity": 2
    }
  ]
}
```

Response:

```json
{
  "orderId": "uuid",
  "status": "RECEIVED"
}
```

### Get order

`GET /orders/{id}`

### List orders

`GET /orders`

### Cancel order

`DELETE /orders/{id}`

## Domain statuses

- `RECEIVED`
- `PROCESSING`
- `APPROVED`
- `REJECTED`
- `OUT_OF_STOCK`
- `PAYMENT_FAILED`
- `FRAUD_DETECTED`
- `SHIPPING`
- `DELIVERED`
- `CANCELLED`

## Event catalog

- `OrderCreated`
- `InventoryValidated`
- `InventoryFailed`
- `PaymentApproved`
- `PaymentFailed`
- `FraudApproved`
- `FraudRejected`
- `OrderApproved`
- `ShippingStarted`
- `ShippingCompleted`

All events use source `order.processing`, version `v1` and carry a correlation ID.

## Local development

Prerequisites:

- Node.js 22+
- npm 10+
- Terraform 1.9+
- Docker

Install dependencies:

```bash
npm install
```

## One-command local workflow

This repository includes a shell script to run the complete local workflow:

```bash
./local.sh help
```

Available commands:

- `./local.sh up`: starts LocalStack and bootstraps local AWS resources
- `./local.sh ready`: runs `up` and starts the local HTTP API for manual/Postman tests
- `./local.sh tf`: runs Terraform checks (`fmt`, `init -backend=false`, `validate`) for `dev` and `prod`
- `./local.sh test`: runs `typecheck`, `lint`, unit/integration tests with coverage and E2E tests
- `./local.sh down`: stops LocalStack and removes volumes
- `./local.sh all`: runs `up + tf + test`

Dedicated shell entry points are also available:

- `./scripts/local-up.sh`: starts Docker/LocalStack and bootstraps local AWS resources
- `./scripts/local-ready.sh`: starts LocalStack/bootstrap and launches the local HTTP API
- `./scripts/terraform-check.sh`: runs the Terraform validation workflow for `dev` and `prod`

Recommended first run:

```bash
chmod +x local.sh
chmod +x scripts/*.sh
./local.sh all
./local.sh down
```

## Local runtime only

If you only want to run the local HTTP API:

```bash
./local.sh up
npm run local:start
```

The local runtime serves:

- `POST /orders`
- `GET /orders/{id}`
- `GET /orders`
- `DELETE /orders/{id}`

## Manual validation commands

If you prefer individual commands instead of `local.sh`:

```bash
./scripts/local-up.sh
./scripts/terraform-check.sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
terraform fmt -check -recursive terraform
```

## Terraform deployment

Terraform is organized by reusable modules and environment compositions:

- `terraform/environments/dev`
- `terraform/environments/prod`

Suggested flow:

```bash
cd terraform/environments/dev
terraform init
terraform plan
terraform apply
```

Validation-only flow used in local quality checks:

```bash
terraform fmt -check -recursive terraform
terraform -chdir=terraform/environments/dev init -backend=false -input=false -upgrade
terraform -chdir=terraform/environments/dev validate
terraform -chdir=terraform/environments/prod init -backend=false -input=false -upgrade
terraform -chdir=terraform/environments/prod validate
```

The Lambda module expects prebuilt zip artifacts under `artifacts/`. A typical CI packaging step can produce files such as:

- `artifacts/create-order.zip`
- `artifacts/get-order.zip`
- `artifacts/list-orders.zip`
- `artifacts/cancel-order.zip`
- `artifacts/inventory.zip`
- `artifacts/payment.zip`
- `artifacts/fraud.zip`
- `artifacts/shipping.zip`
- `artifacts/notification.zip`
- `artifacts/update-order.zip`

## Observability and security

- Structured JSON logging with request ID, correlation ID and order ID
- Dedicated EventBridge bus
- CloudWatch dashboard and alarms
- SQS dead-letter queue
- API protected by WAF rate limiting
- Least-privilege IAM roles for Lambda and Step Functions

## Test strategy

Current automated coverage includes:

- Create order success path
- Idempotent create order flow
- Inventory failure path
- Payment failure path
- Fraud approval and rejection
- Shipping completion path
- HTTP handlers success, validation errors and unknown error branches
- Async handlers and adapters/repositories
- LocalStack E2E scenarios for approved, out-of-stock, payment-failed, fraud-rejected and cancel flows

Current quality status:

- Unit/integration coverage over `src/**`: `100%` statements, branches, functions and lines
- E2E suite: executable locally with LocalStack and Docker running (`npm run test:e2e`)

## Troubleshooting

- If E2E fails with `port is already allocated` for `4567`, stop/remove stale containers using that port and rerun `./local.sh up`.
- If Docker is not running, LocalStack startup and E2E tests will fail.
- If Terraform is not installed, `./local.sh tf` fails fast with a dependency error.

## Next evolutions

- Package Lambdas with esbuild for production deploys
- Add DynamoDB streams or outbox if stronger delivery guarantees are required
- Move Terraform state to S3 + DynamoDB locking
- Add X-Ray tracing and custom CloudWatch metrics emission