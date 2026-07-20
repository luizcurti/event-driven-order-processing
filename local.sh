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
  ./local.sh down     # Stop LocalStack and remove volumes
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
    down)
      down
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
