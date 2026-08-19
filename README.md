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
- `./local.sh down`: stops LocalStack and removes volumes (leaves the observability stack running, if up)
- `./local.sh obs`: starts LocalStack (if needed) plus Prometheus, Pushgateway, Loki, Promtail and Grafana
- `./local.sh obs:down`: stops only the observability stack and removes its volumes (leaves LocalStack running)
- `./local.sh lambdas`: packages and deploys the real Lambda handlers into LocalStack
- `./local.sh all`: runs `up + tf + test`

Dedicated shell entry points are also available:

- `./scripts/local-up.sh`: starts Docker/LocalStack and bootstraps local AWS resources
- `./scripts/local-ready.sh`: starts LocalStack/bootstrap and launches the local HTTP API
- `./scripts/terraform-check.sh`: runs the Terraform validation workflow for `dev` and `prod`
- `./scripts/local-down.sh`: stops LocalStack and removes volumes (tears down the local environment)

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
./scripts/local-down.sh
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
- Local metrics (Prometheus/Pushgateway) and log aggregation (Grafana/Loki) for local development — see below

### Local observability stack (Grafana, Prometheus, Pushgateway, Loki)

In production, Lambdas are observed via CloudWatch (see the architecture section above). Locally there are two ways
to run the system, both instrumented end to end:

**1. Direct-call shim (default, used by `npm run local:start` and the e2e suite)** — a long-lived Node HTTP server
(`scripts/localstack/server.ts`) calls the use-case classes directly and orchestrates the workflow itself. Fast,
zero LocalStack Lambda/Step Functions dependency, what CI runs.

- Exposes Prometheus metrics at `GET /metrics` (`prom-client`): default Node process metrics, an
  `http_request_duration_seconds` histogram per route/method/status, an `orders_created_total` counter and an
  `order_workflow_outcomes_total` counter labeled by outcome (`approved`, `out_of_stock`, `payment_failed`,
  `fraud_rejected`).
- The structured JSON logger (`src/shared/infrastructure/logger.ts`) additionally writes every log line to
  `logs/local-server.log` when `LOG_FILE_PATH` is set — the local server sets it automatically.

**2. Real Lambda execution (`USE_REAL_LAMBDAS=true`)** — the shim instead invokes the actual bundled Lambda
handlers (`src/*/handler/index.ts`) deployed for real into LocalStack (`./local.sh lambdas`), and the rest of the
pipeline — EventBridge rules, the Step Functions state machine (built from the very same
`terraform/environments/dev/order-processing.asl.json.tpl` used in prod), and SQS event source mappings — runs
autonomously inside LocalStack, exactly mirroring the deployed topology in `terraform/environments/dev/main.tf`.
Since each Lambda invocation is a short-lived process, it can't be scraped; instead it pushes
`lambda_invocations_total`/`lambda_invocation_duration_seconds` to Pushgateway on completion
(`pushInvocationMetrics` in `src/shared/infrastructure/metrics.ts`), gated by `PUSHGATEWAY_URL` so this has zero
effect when actually deployed to AWS. Container logs from the ephemeral per-invocation Lambda containers are
picked up automatically by Promtail via Docker service discovery.

Promtail also tails `logs/local-server.log` for the shim's own logs; Prometheus scrapes both the shim
(`host.docker.internal:3000`) and Pushgateway; Grafana is pre-provisioned with both datasources and an
"Order Processing - Local Server" dashboard (request rate/latency, order outcomes, Lambda invocation rate/duration,
live logs from both sources).

Everything (LocalStack, Prometheus, Pushgateway, Loki, Promtail and Grafana) lives in the single
`docker-compose.localstack.yml`, split by a Compose profile: `./local.sh up` (`docker compose up -d`, no profile)
starts only LocalStack — what CI uses — while `./local.sh obs` (`--profile observability`) additionally brings up
the observability stack. `./local.sh obs` on its own is enough to start both; run `./local.sh up` on its own only
when you don't need observability.

Usage (direct-call shim):

```bash
./local.sh obs
npm run local:start
```

Usage (real Lambda execution, full production-topology fidelity):

```bash
./local.sh obs
./local.sh lambdas
USE_REAL_LAMBDAS=true npm run local:start
```

Then open Grafana at http://localhost:3001 (anonymous access, no login required), Prometheus at
http://localhost:9090, and Pushgateway at http://localhost:9091. `./local.sh obs:down` tears down only the
observability containers (LocalStack keeps running); `./local.sh down` tears down only LocalStack.

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
- If `./local.sh down` fails to remove the `event-driven-order-processing-observability` network with "has active
  endpoints", LocalStack's per-invocation Lambda containers (from `USE_REAL_LAMBDAS=true` runs) didn't get cleaned
  up on shutdown — remove them with `docker rm -f $(docker ps -aq --filter name=localstack-lambda-)` and retry.

## Next evolutions

- Package Lambdas with esbuild for production deploys (done for local LocalStack deploys —
  `scripts/localstack/package-lambdas.ts` — still pending for the CI/Terraform `artifacts/*.zip` pipeline)
- Add DynamoDB streams or outbox if stronger delivery guarantees are required
- Move Terraform state to S3 + DynamoDB locking
- Add X-Ray tracing and custom CloudWatch metrics emission
