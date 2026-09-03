#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_usage() {
  cat <<'EOF'
Usage:
  ./local.sh up       # Start LocalStack and bootstrap local resources
  ./local.sh ready    # Start LocalStack/bootstrap and run local HTTP API (Postman ready)
  ./local.sh tf       # Validate Terraform (fmt + init -backend=false + validate)
  ./local.sh test     # Run typecheck, lint, unit/coverage tests and e2e
  ./local.sh api      # Start LocalStack/bootstrap, run local HTTP API and the Postman collection via newman
  ./local.sh down     # Stop LocalStack and remove volumes (leaves the observability stack running, if up)
  ./local.sh obs      # Start LocalStack (if needed) plus Prometheus, Pushgateway, Loki, Promtail and Grafana
  ./local.sh obs:down # Stop only the observability stack and remove its volumes (leaves LocalStack running)
  ./local.sh lambdas  # Package and deploy the real Lambda handlers into LocalStack
  ./local.sh all      # Run up + tf + test
  ./local.sh help     # Show this help
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command not found: $cmd"
    exit 1
  fi
}

run_npm() {
  local script_name="$1"
  echo "==> npm run ${script_name}"
  (cd "$ROOT_DIR" && npm run "$script_name")
}

run_terraform_checks() {
  local env_dir

  require_cmd terraform

  echo "==> terraform fmt -check -recursive terraform"
  (cd "$ROOT_DIR" && terraform fmt -check -recursive terraform)

  for env_dir in "$ROOT_DIR/terraform/environments/dev" "$ROOT_DIR/terraform/environments/prod"; do
    echo "==> terraform init -backend=false (${env_dir})"
    terraform -chdir="$env_dir" init -backend=false -input=false -upgrade >/dev/null

    echo "==> terraform validate (${env_dir})"
    terraform -chdir="$env_dir" validate
  done
}

up() {
  require_cmd docker
  require_cmd npm
  run_npm localstack:up
  run_npm local:bootstrap

  cat <<'EOF'
LocalStack and local resources are ready.
To start the local HTTP API:
  npm run local:start
EOF
}

tests() {
  require_cmd npm
  run_npm typecheck
  run_npm lint
  run_npm test
  run_npm test:e2e
}

api_test() {
  require_cmd npm
  require_cmd curl
  up

  local port="${PORT:-3000}"
  local base_url="http://127.0.0.1:${port}"
  local log_file="$ROOT_DIR/logs/api-test-server.log"
  mkdir -p "$ROOT_DIR/logs"

  echo "==> starting local HTTP API for collection tests (port ${port})"
  # `exec` replaces the subshell with the tsx process itself, so $! is the
  # actual server PID -- without it, `kill "$server_pid"` only terminates an
  # empty subshell wrapper and leaves the real server running as an orphan.
  # Calling the locally installed binary directly (not `npx tsx`) avoids an
  # extra process layer that would reintroduce the same problem.
  (cd "$ROOT_DIR" && exec "$ROOT_DIR/node_modules/.bin/tsx" scripts/localstack/server.ts >"$log_file" 2>&1) &
  local server_pid=$!
  trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT

  echo "==> waiting for local HTTP API on ${base_url}"
  if ! curl -fsS "${base_url}/metrics" --retry 60 --retry-delay 1 --retry-connrefused >/dev/null; then
    echo "Error: local HTTP API did not become ready in time. See $log_file"
    exit 1
  fi

  echo "==> npx newman run postman/event-driven-order-processing.local.postman_collection.json"
  local exit_code=0
  npx --yes newman@6.2.2 run \
    "$ROOT_DIR/postman/event-driven-order-processing.local.postman_collection.json" \
    --env-var "baseUrl=${base_url}" \
    || exit_code=$?

  exit "$exit_code"
}

down() {
  require_cmd npm
  run_npm localstack:down
}

all() {
  up
  run_terraform_checks
  tests
}

ready() {
  up
  echo "==> npm run local:start"
  echo "Press Ctrl+C to stop the local HTTP API."
  (cd "$ROOT_DIR" && npm run local:start)
}

obs_up() {
  require_cmd docker
  require_cmd npm
  run_npm observability:up
  run_npm local:bootstrap

  cat <<'EOF'
LocalStack, Prometheus, Pushgateway, Loki, Promtail and Grafana are up.
  Grafana:     http://localhost:3001 (anonymous access, "Order Processing - Local Server" dashboard)
  Prometheus:  http://localhost:9090
  Pushgateway: http://localhost:9091
Start the local HTTP API (npm run local:start) so Prometheus has something to scrape at /metrics
and structured logs are written to logs/local-server.log for Promtail to ship to Loki.
Run `./local.sh lambdas` to deploy the real Lambda handlers, then
`USE_REAL_LAMBDAS=true npm run local:start` for full production-topology fidelity
(real EventBridge rules, Step Functions and SQS event source mappings, with
per-invocation metrics pushed to Pushgateway and logs captured from the Lambda
containers by Promtail).
EOF
}

obs_down() {
  require_cmd npm
  run_npm observability:down
}

lambdas() {
  require_cmd npm
  run_npm local:deploy-lambdas
}

main() {
  local action="${1:-help}"

  case "$action" in
    up)
      up
      ;;
    ready)
      ready
      ;;
    tf)
      run_terraform_checks
      ;;
    test)
      tests
      ;;
    api)
      api_test
      ;;
    down)
      down
      ;;
    obs)
      obs_up
      ;;
    obs:down)
      obs_down
      ;;
    lambdas)
      lambdas
      ;;
    all)
      all
      ;;
    help|-h|--help)
      print_usage
      ;;
    *)
      echo "Invalid action: $action"
      echo
      print_usage
      exit 1
      ;;
  esac
}

main "$@"
